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
    return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
  }

  function renderInline(text) {
    const placeholders = [];
    const pushToken = html => {
      const key = `__RT_${placeholders.length}__`;
      placeholders.push({ key, html });
      return key;
    };

    let html = String(text || '');
    html = html.replace(/`([^`\n]+)`/g, (_, code) => pushToken(`<code class="px-1 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[0.95em]">${escapeHtml(code)}</code>`));
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const safe = safeUrl(url);
      if (!safe) return escapeHtml(label);
      return pushToken(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline underline-offset-2">${escapeHtml(label)}</a>`);
    });

    html = escapeHtml(html);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    placeholders.forEach(entry => {
      html = html.replace(entry.key, entry.html);
    });

    return html;
  }

  function renderListItemContent(text, options, taskState) {
    const task = String(text || '').match(/^\[( |x|X)\]\s+([\s\S]+)$/);
    if (!task) return renderInline(text);

    const checked = /[xX]/.test(task[1]);
    const taskIndex = taskState.index++;
    return `
      <label class="inline-flex items-start gap-2">
        <input type="checkbox" data-rt-task-index="${taskIndex}" class="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 ${options.interactiveTasks ? 'cursor-pointer' : ''}" ${checked ? 'checked' : ''} ${options.interactiveTasks ? '' : 'disabled'}>
        <span class="${checked ? 'line-through text-slate-500' : ''}">${renderInline(task[2])}</span>
      </label>
    `;
  }

  function renderRichText(value, options = {}) {
    const renderOptions = {
      interactiveTasks: false,
      ...options,
    };
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';

    const lines = text.split('\n');
    const html = [];
    let index = 0;
    const taskState = { index: 0 };

    while (index < lines.length) {
      const rawLine = lines[index];
      const line = rawLine.trim();

      if (!line) {
        index += 1;
        continue;
      }

      if (/^```/.test(line)) {
        const buffer = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          buffer.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        html.push(`<pre class="overflow-x-auto rounded-xl bg-slate-900 text-slate-100 px-3 py-2 text-xs"><code>${escapeHtml(buffer.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 1, 6);
        html.push(`<h${level} class="font-semibold text-slate-800">${renderInline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const buffer = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          buffer.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        html.push(`<blockquote class="border-l-4 border-slate-300 pl-3 text-slate-600">${buffer.map(renderInline).join('<br>')}</blockquote>`);
        continue;
      }

      if (/^\[( |x|X)\]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\[( |x|X)\]\s+/.test(lines[index].trim())) {
          items.push(`<li class="list-none">${renderListItemContent(lines[index].trim(), renderOptions, taskState)}</li>`);
          index += 1;
        }
        html.push(`<ul class="pl-0 space-y-1">${items.join('')}</ul>`);
        continue;
      }

      if (/^(\-|\*|\d+\.)\s+/.test(line)) {
        const ordered = /^\d+\./.test(line);
        const items = [];
        while (index < lines.length && /^(\-|\*|\d+\.)\s+/.test(lines[index].trim())) {
          items.push(`<li>${renderListItemContent(lines[index].trim().replace(/^(\-|\*|\d+\.)\s+/, ''), renderOptions, taskState)}</li>`);
          index += 1;
        }
        html.push(`<${ordered ? 'ol' : 'ul'} class="${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1">${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }

      const buffer = [];
      while (index < lines.length && lines[index].trim() && !/^```/.test(lines[index].trim()) && !/^(#{1,6})\s+/.test(lines[index].trim()) && !/^>\s?/.test(lines[index].trim()) && !/^(\-|\*|\d+\.)\s+/.test(lines[index].trim())) {
        buffer.push(lines[index]);
        index += 1;
      }
      html.push(`<p>${buffer.map(renderInline).join('<br>')}</p>`);
    }

    return `<div class="space-y-2 leading-6">${html.join('')}</div>`;
  }

  function richTextToPlainText(value) {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, '').trim())
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^(\-|\*|\d+\.)\s+/gm, '')
      .replace(/^\[( |x|X)\]\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
