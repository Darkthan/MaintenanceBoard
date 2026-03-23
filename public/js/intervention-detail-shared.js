(function() {
  const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  function renderAttachment(message, escapeHtml) {
    if (!message.attachmentPath) return '';
    const url = `/uploads/${message.attachmentPath}`;
    const name = escapeHtml(message.attachmentName || 'Fichier joint');
    const mime = message.attachmentMime || '';
    const size = message.attachmentSize ? ` (${(message.attachmentSize / 1024).toFixed(0)} Ko)` : '';
    if (IMAGE_MIMES.includes(mime)) {
      return `<a href="${url}" target="_blank" class="block mt-1">
        <img src="${url}" alt="${name}" class="max-w-full rounded-lg max-h-32 object-cover" loading="lazy" />
      </a>`;
    }
    return `<a href="${url}" target="_blank" download
      class="flex items-center gap-1.5 mt-1 px-2 py-1 bg-black/10 rounded-lg text-xs hover:bg-black/20 transition">
      <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <span class="truncate">${name}${size}</span>
    </a>`;
  }

  function compressImage(file, maxWidth = 1200, quality = 0.82) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = event => {
        const image = new Image();
        image.onload = () => {
          const ratio = Math.min(1, maxWidth / image.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * ratio);
          canvas.height = Math.round(image.height * ratio);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
        };
        image.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function createInterventionDetailController(config) {
    const state = {
      currentId: null,
      currentData: null,
      pendingFile: null,
      mergeCandidates: []
    };

    function el(key) {
      return document.getElementById(config.ids[key]);
    }

    function renderRichContent(value) {
      if (typeof window.renderRichText === 'function') return window.renderRichText(value);
      return config.escapeHtml(String(value || '')).replace(/\n/g, '<br>');
    }

    function refreshNotesPreview(value) {
      const preview = config.ids.notesPreview ? el('notesPreview') : null;
      if (!preview) return;
      const content = String(value || '').trim();
      if (!content) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
        return;
      }
      preview.innerHTML = renderRichContent(content);
      preview.classList.remove('hidden');
    }

    function closeAttributeEditor(field) {
      const display = document.getElementById(config.attributeIds[field].display);
      const editor = document.getElementById(config.attributeIds[field].editor);
      if (!display || !editor) return;
      editor.classList.add('hidden');
      display.classList.remove('hidden');
    }

    function openAttributeEditor(field) {
      const attr = config.attributeIds[field];
      const display = document.getElementById(attr.display);
      const editor = document.getElementById(attr.editor);
      if (!display || !editor || !state.currentData) return;

      if (attr.input) {
        const input = document.getElementById(attr.input);
        const value = field === 'title' ? state.currentData.title
          : field === 'status' ? state.currentData.status
          : field === 'priority' ? state.currentData.priority
          : field === 'description' ? state.currentData.description
          : state.currentData.resolution;
        input.value = value || attr.defaultValue || '';
      }

      display.classList.add('hidden');
      editor.classList.remove('hidden');
    }

    function buildAttributePayload(field) {
      const attr = config.attributeIds[field];
      const input = document.getElementById(attr.input);
      const raw = input ? input.value : '';
      if (field === 'title') return { title: raw.trim() };
      if (field === 'status') return { status: raw };
      if (field === 'priority') return { priority: raw };
      if (field === 'description') return { description: raw || null };
      if (field === 'resolution') return { resolution: raw || null };
      return {};
    }

    function renderReporters(reporters = []) {
      const wrap = el('reportersWrap');
      const list = el('reportersList');
      if (!wrap || !list) return;
      if (!state.currentData || state.currentData.source !== 'PUBLIC') {
        wrap.classList.add('hidden');
        list.innerHTML = '';
        return;
      }

      wrap.classList.remove('hidden');
      list.innerHTML = reporters.length
        ? reporters.map(reporter => `
          <div class="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm">
            <span class="font-medium text-slate-700">${config.escapeHtml(reporter.name || 'Demandeur')}</span>
            ${reporter.email ? `<span class="text-slate-400">${config.escapeHtml(reporter.email)}</span>` : ''}
          </div>
        `).join('')
        : '<p class="text-sm text-slate-400">Aucun demandeur rattaché.</p>';
    }

    function renderOrders(orders = []) {
      const container = el('orders');
      if (!container) return;
      if (!orders.length) {
        container.innerHTML = `<div class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-400 text-center">
          ${config.emptyOrdersMessage || 'Aucune commande liée'}
        </div>`;
        return;
      }

      container.innerHTML = orders.map(order => `
        <form class="border border-slate-200 rounded-xl p-4 space-y-3" onsubmit="event.preventDefault(); ${config.globalNames.updateOrder}('${order.id}', this)">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="font-medium text-slate-800">${config.escapeHtml(order.title)}</h4>
                ${config.orderStatusBadge(order.status)}
              </div>
              <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span>BC ${order.id.slice(-6).toUpperCase()}</span>
                ${order.supplier ? `<span>Fournisseur: ${config.escapeHtml(order.supplier)}</span>` : ''}
                ${order.receivedAt ? `<span>Reçue le ${config.formatDateOnly(order.receivedAt)}</span>` : ''}
              </div>
            </div>
            <a href="${config.orderLink(order.id)}" class="text-xs text-blue-600 hover:underline flex-shrink-0">Ouvrir la commande</a>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Statut</label>
              <select name="status" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="PENDING" ${order.status === 'PENDING' ? 'selected' : ''}>En attente</option>
                <option value="ORDERED" ${order.status === 'ORDERED' ? 'selected' : ''}>Commandée</option>
                <option value="PARTIAL" ${order.status === 'PARTIAL' ? 'selected' : ''}>Partielle</option>
                <option value="RECEIVED" ${order.status === 'RECEIVED' ? 'selected' : ''}>Reçue</option>
                <option value="CANCELLED" ${order.status === 'CANCELLED' ? 'selected' : ''}>Annulée</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Date de commande</label>
              <input name="orderedAt" type="date" value="${config.toDateInputValue(order.orderedAt)}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Réception prévue</label>
              <input name="expectedDeliveryAt" type="date" value="${config.toDateInputValue(order.expectedDeliveryAt)}"
                class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Notes de suivi</label>
            <textarea name="trackingNotes" rows="3"
              class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Ex: commande passée chez X, attente validation, livraison annoncée vendredi...">${config.escapeHtml(order.trackingNotes || '')}</textarea>
          </div>
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-slate-400">
              ${order.orderedAt ? `Commandée le ${config.formatDateOnly(order.orderedAt)}` : 'Pas encore marquée comme commandée'}
            </p>
            <button type="submit" class="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition">
              Enregistrer le suivi
            </button>
          </div>
        </form>
      `).join('');
    }

    async function open(id) {
      state.currentId = id;
      state.currentData = null;
      config.onOpenStart?.();
      try {
        const intervention = await config.fetchIntervention(id);
        state.currentData = intervention;

        el('meta').textContent = `Intervention #${intervention.id.slice(-6).toUpperCase()}`;
        el('title').textContent = intervention.title;
        el('statusDisplay').innerHTML = config.statusBadge(intervention.status);
        el('priorityDisplay').innerHTML = config.priorityBadge(intervention.priority);
        el('source').innerHTML = config.sourceBadge(intervention.source);
        el('tech').textContent = intervention.tech?.name || '—';
        el('created').textContent = config.formatDate(intervention.createdAt);
        el('room').textContent = config.formatRoom(intervention);
        el('equipment').textContent = config.formatEquipment(intervention);
        if (config.ids.fullLink) el('fullLink').href = config.fullLink(intervention.id);
        if (config.ids.notesInput) {
          el('notesInput').value = intervention.notes || '';
          refreshNotesPreview(intervention.notes || '');
        }

        const setBlock = (wrapKey, contentKey, value) => {
          const wrap = el(wrapKey);
          if (!wrap) return;
          if (value) {
            el(contentKey).innerHTML = renderRichContent(value);
            wrap.classList.remove('hidden');
          } else {
            wrap.classList.add('hidden');
          }
        };

        setBlock('descriptionWrap', 'description', intervention.description);
        setBlock('resolutionWrap', 'resolution', intervention.resolution);
        ['title', 'status', 'priority', 'description', 'resolution'].forEach(closeAttributeEditor);
        renderReporters(intervention.reporters || []);
        renderOrders(intervention.orders || []);

        const photosWrap = el('photosWrap');
        if (photosWrap) {
          const photos = Array.isArray(intervention.photos) ? intervention.photos : [];
          if (photos.length) {
            el('photosCount').textContent = `${photos.length} photo(s)`;
            el('photos').innerHTML = photos.map(photo => `
              <a href="${config.escapeHtml(photo)}" target="_blank" class="block group">
                <img src="${config.escapeHtml(photo)}" alt="Photo intervention" class="w-full h-28 object-cover rounded-xl border border-slate-200 group-hover:opacity-90 transition" />
              </a>
            `).join('');
            photosWrap.classList.remove('hidden');
          } else {
            photosWrap.classList.add('hidden');
            el('photos').innerHTML = '';
            el('photosCount').textContent = '';
          }
        }

        const messagesWrap = el('messagesWrap');
        if (messagesWrap) {
          if (intervention.source === 'PUBLIC') {
            messagesWrap.classList.remove('hidden');
            el('messageInput').value = '';
            el('messageError').classList.add('hidden');
            clearPendingFile();
            await loadMessages(id);
          } else {
            messagesWrap.classList.add('hidden');
            el('messages').innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Aucun message.</p>';
          }
        }

        config.onOpenSuccess?.(intervention);
      } catch (error) {
        config.onOpenError?.(error);
      }
    }

    function close() {
      config.onClose?.();
      state.currentId = null;
      state.currentData = null;
      clearPendingFile();
      if (config.ids.reportersWrap) {
        el('reportersWrap').classList.add('hidden');
      }
    }

    async function saveAttribute(field) {
      if (!state.currentId) return;
      try {
        await config.patchIntervention(state.currentId, buildAttributePayload(field));
        closeAttributeEditor(field);
        config.toast('Attribut mis à jour');
        await config.onRefresh?.(state.currentId);
        await open(state.currentId);
      } catch (error) {
        config.toast(error.message || 'Mise à jour impossible', 'error');
      }
    }

    async function saveNotes() {
      if (!state.currentId) return;
      const button = el('saveNotesBtn');
      if (button) button.disabled = true;
      try {
        await config.patchIntervention(state.currentId, { notes: el('notesInput').value || null });
        config.toast('Notes enregistrées');
        await config.onRefresh?.(state.currentId);
        await open(state.currentId);
      } catch (error) {
        config.toast(error.message || 'Enregistrement impossible', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function updateOrder(orderId, form) {
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        await config.patchOrder(orderId, {
          status: form.status.value,
          orderedAt: form.orderedAt.value || null,
          expectedDeliveryAt: form.expectedDeliveryAt.value || null,
          trackingNotes: form.trackingNotes.value || null
        });
        config.toast('Suivi de commande mis à jour');
        await config.onRefresh?.(state.currentId);
        await open(state.currentId);
      } catch (error) {
        config.toast(error.message || 'Mise à jour impossible', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function openMergeModal() {
      if (!state.currentId || state.currentData?.source !== 'PUBLIC') return;
      const modal = el('mergeModal');
      const select = el('mergeTargetSelect');
      const error = el('mergeError');
      error.classList.add('hidden');
      select.innerHTML = '<option value="">Chargement...</option>';
      modal.classList.remove('hidden');

      try {
        const result = await config.listMergeCandidates();
        state.mergeCandidates = (result.data || []).filter(item => item.id !== state.currentId);
        select.innerHTML = '<option value="">-- Sélectionner --</option>' + state.mergeCandidates.map(item => `
          <option value="${item.id}">${config.escapeHtml(item.title)}${item.room ? ` - ${config.escapeHtml(item.room.name)}` : ''}</option>
        `).join('');
      } catch (errorMessage) {
        error.textContent = errorMessage.message;
        error.classList.remove('hidden');
        select.innerHTML = '<option value="">-- Indisponible --</option>';
      }
    }

    function closeMergeModal() {
      const modal = el('mergeModal');
      if (modal) modal.classList.add('hidden');
    }

    async function submitMerge() {
      if (!state.currentId) return;
      const targetId = el('mergeTargetSelect').value;
      const error = el('mergeError');
      const button = el('mergeSubmitBtn');
      error.classList.add('hidden');
      if (!targetId) {
        error.textContent = 'Sélectionnez une intervention cible.';
        error.classList.remove('hidden');
        return;
      }

      button.disabled = true;
      try {
        await config.mergeIntervention(state.currentId, targetId);
        closeMergeModal();
        config.toast('Demandes fusionnées');
        await config.afterMerge?.(targetId, state.currentId);
      } catch (mergeError) {
        error.textContent = mergeError.message;
        error.classList.remove('hidden');
      } finally {
        button.disabled = false;
      }
    }

    function onFileSelected(input) {
      const file = input.files[0];
      if (!file) return;
      state.pendingFile = file;
      el('filePreviewName').textContent = file.name;
      el('filePreview').classList.remove('hidden');
    }

    function clearPendingFile() {
      state.pendingFile = null;
      if (config.ids.fileInput) el('fileInput').value = '';
      if (config.ids.filePreview) el('filePreview').classList.add('hidden');
      if (config.ids.filePreviewName) el('filePreviewName').textContent = '';
    }

    if (config.ids.notesInput && config.ids.notesPreview) {
      const notesInput = el('notesInput');
      if (notesInput && !notesInput.dataset.richTextPreviewBound) {
        notesInput.addEventListener('input', event => refreshNotesPreview(event.target.value));
        notesInput.dataset.richTextPreviewBound = 'true';
      }
    }

    async function loadMessages(interventionId) {
      const container = el('messages');
      try {
        const messages = await config.getMessages(interventionId);
        if (!messages || messages.length === 0) {
          container.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Aucun message.</p>';
          return;
        }
        container.innerHTML = messages.map(message => {
          const isReporter = message.authorType === 'REPORTER';
          const name = config.escapeHtml(message.authorName || (isReporter ? 'Demandeur' : 'Équipe technique'));
          const time = new Date(message.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          const attachment = renderAttachment(message, config.escapeHtml);
          const text = message.content ? `<div class="whitespace-pre-wrap">${config.escapeHtml(message.content)}</div>` : '';
          if (isReporter) {
            const unreadDot = !message.readAt
              ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0 ml-1" title="Non lu"></span>'
              : '';
            return `<div class="flex justify-start${config.messagesReporterExtraClass ? ` ${config.messagesReporterExtraClass}` : ''}">
              <div class="max-w-[85%]">
                <p class="text-xs text-slate-400 mb-0.5 flex items-center gap-1">${name} · ${time}${unreadDot}</p>
                <div class="bg-orange-50 border border-orange-200 text-slate-700 rounded-xl rounded-tl-sm px-3 py-2 text-xs">${text}${attachment}</div>
              </div>
            </div>`;
          }
          const readIndicator = message.readAt
            ? `<span class="text-blue-200 text-xs" title="Lu par le demandeur le ${new Date(message.readAt).toLocaleString('fr-FR')}">✓✓</span>`
            : '<span class="text-blue-300/60 text-xs" title="Envoyé, en attente de lecture">✓</span>';
          return `<div class="flex justify-end">
            <div class="max-w-[85%]">
              <p class="text-xs text-slate-400 text-right mb-0.5">Vous · ${time}</p>
              <div class="bg-blue-600 text-white rounded-xl rounded-tr-sm px-3 py-2 text-xs">${text}${attachment}</div>
              <div class="flex justify-end mt-0.5">${readIndicator}</div>
            </div>
          </div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
        await config.afterMessagesLoaded?.(interventionId);
      } catch {
        container.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Impossible de charger les messages.</p>';
      }
    }

    async function sendMessage() {
      if (!state.currentId) return;
      const input = el('messageInput');
      const error = el('messageError');
      const content = input.value.trim();
      error.classList.add('hidden');
      if (!content && !state.pendingFile) return;
      if (content.length > 2000) {
        error.textContent = 'Le message ne peut pas dépasser 2000 caractères.';
        error.classList.remove('hidden');
        return;
      }

      try {
        let fileToSend = state.pendingFile;
        if (fileToSend && IMAGE_MIMES.includes(fileToSend.type)) {
          fileToSend = await compressImage(fileToSend);
        }

        const formData = new FormData();
        if (content) formData.append('content', content);
        if (fileToSend) formData.append('attachment', fileToSend, state.pendingFile.name);

        await config.uploadMessage(state.currentId, formData);
        input.value = '';
        clearPendingFile();
        await loadMessages(state.currentId);
        await config.onRefresh?.(state.currentId);
      } catch (sendError) {
        error.textContent = sendError.message || 'Erreur lors de l\'envoi.';
        error.classList.remove('hidden');
      }
    }

    function createOrder() {
      if (!state.currentId) return;
      window.location = config.createOrderLink(state.currentId);
    }

    return {
      open,
      close,
      openAttributeEditor,
      closeAttributeEditor,
      saveAttribute,
      saveNotes,
      updateOrder,
      openMergeModal,
      closeMergeModal,
      submitMerge,
      onFileSelected,
      clearPendingFile,
      loadMessages,
      sendMessage,
      createOrder,
      getCurrentId: () => state.currentId,
      getCurrentData: () => state.currentData
    };
  }

  window.createInterventionDetailController = createInterventionDetailController;
})();
