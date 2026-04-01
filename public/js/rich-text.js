(function() {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    const value = String(url || '').trim();
    if (!value) return null;
    if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return null;
  }

  let markdownRenderer = null;

  function getMarkdownRenderer() {
    if (markdownRenderer || typeof window.markdownit !== 'function') return markdownRenderer;

    markdownRenderer = window.markdownit({
      html: false,
      breaks: true,
      linkify: true,
      typographer: false,
    });

    const defaultLinkOpen = markdownRenderer.renderer.rules.link_open
      || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

    markdownRenderer.renderer.rules.link_open = function(tokens, idx, options, env, self) {
      const hrefIndex = tokens[idx].attrIndex('href');
      const href = hrefIndex >= 0 ? tokens[idx].attrs[hrefIndex][1] : '';
      const safe = safeUrl(href);
      if (!safe) {
        tokens[idx].attrs[hrefIndex][1] = '#';
      } else if (hrefIndex >= 0) {
        tokens[idx].attrs[hrefIndex][1] = safe;
      }
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    return markdownRenderer;
  }

  function decorateTaskNode(node, options, state) {
    const contentNode = node.tagName === 'LI' && node.children.length === 1 && node.firstElementChild?.tagName === 'P'
      ? node.firstElementChild
      : node;
    const html = String(contentNode.innerHTML || '').trim();
    const task = html.match(/^\[( |x|X)\]\s+([\s\S]+)$/);
    if (!task) return;

    const checked = /[xX]/.test(task[1]);
    const taskIndex = state.taskIndex++;
    node.classList.add('rich-task-item');
    if (node.tagName === 'LI') {
      node.classList.add('list-none', 'ml-[-1.25rem]');
    }

    contentNode.innerHTML = `
      <label class="inline-flex items-start gap-2">
        <input
          type="checkbox"
          data-rt-task-index="${taskIndex}"
          class="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 ${options.interactiveTasks ? 'cursor-pointer' : ''}"
          ${checked ? 'checked' : ''}
          ${options.interactiveTasks ? '' : 'disabled'}
        >
        <span class="${checked ? 'line-through text-slate-500' : ''}">${task[2]}</span>
      </label>
    `;
  }

  function decorateRenderedHtml(html, options) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const state = { taskIndex: 0 };

    wrapper.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(node => {
      node.classList.add('font-semibold', 'text-slate-800');
    });
    wrapper.querySelectorAll('p').forEach(node => {
      node.classList.add('text-slate-700');
    });
    wrapper.querySelectorAll('blockquote').forEach(node => {
      node.classList.add('border-l-4', 'border-slate-300', 'pl-3', 'text-slate-600');
    });
    wrapper.querySelectorAll('pre').forEach(node => {
      node.classList.add('overflow-x-auto', 'rounded-xl', 'bg-slate-900', 'text-slate-100', 'px-3', 'py-2', 'text-xs');
    });
    wrapper.querySelectorAll('code').forEach(node => {
      if (node.parentElement?.tagName === 'PRE') return;
      node.classList.add('px-1', 'py-0.5', 'rounded', 'bg-slate-200', 'text-slate-800', 'font-mono', 'text-[0.95em]');
    });
    wrapper.querySelectorAll('ul').forEach(node => {
      node.classList.add('list-disc', 'pl-5', 'space-y-1');
    });
    wrapper.querySelectorAll('ol').forEach(node => {
      node.classList.add('list-decimal', 'pl-5', 'space-y-1');
    });
    wrapper.querySelectorAll('a').forEach(node => {
      const safe = safeUrl(node.getAttribute('href'));
      if (!safe) {
        const text = document.createTextNode(node.textContent || '');
        node.replaceWith(text);
        return;
      }
      node.setAttribute('href', safe);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
      node.classList.add('text-blue-600', 'underline', 'underline-offset-2');
    });
    wrapper.querySelectorAll('img').forEach(node => {
      const safe = safeUrl(node.getAttribute('src'));
      if (!safe) {
        node.remove();
        return;
      }
      node.setAttribute('src', safe);
      node.setAttribute('loading', 'lazy');
      node.classList.add('mt-3', 'max-h-[32rem]', 'w-auto', 'max-w-full', 'rounded-2xl', 'border', 'border-slate-200', 'bg-white', 'shadow-sm');
    });

    wrapper.querySelectorAll('li').forEach(node => decorateTaskNode(node, options, state));
    Array.from(wrapper.children)
      .filter(node => node.tagName === 'P')
      .forEach(node => decorateTaskNode(node, options, state));

    return wrapper.innerHTML;
  }

  function renderRichText(value, options = {}) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';

    const renderer = getMarkdownRenderer();
    if (!renderer) {
      return `<div class="space-y-2 leading-6"><p>${escapeHtml(text)}</p></div>`;
    }

    const html = renderer.render(text);
    return `<div class="space-y-2 leading-6">${decorateRenderedHtml(html, {
      interactiveTasks: false,
      ...options,
    })}</div>`;
  }

  function richTextToPlainText(value) {
    const html = renderRichText(value);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    return wrapper.textContent.replace(/\n{3,}/g, '\n\n').trim();
  }

  function toggleRichTextTask(value, taskIndex, checked) {
    let seen = 0;
    return String(value || '').replace(
      /^(\s*(?:(?:\-|\*|\d+\.)\s+)?)\[( |x|X)\](\s+.*)$/gm,
      (match, prefix, _mark, suffix) => {
        if (seen !== taskIndex) {
          seen += 1;
          return match;
        }
        seen += 1;
        return `${prefix}[${checked ? 'x' : ' '}]${suffix}`;
      }
    );
  }

  window.renderRichText = renderRichText;
  window.richTextToPlainText = richTextToPlainText;
  window.toggleRichTextTask = toggleRichTextTask;
})();
