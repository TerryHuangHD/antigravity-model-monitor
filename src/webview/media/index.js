(function () {
  const vscode = acquireVsCodeApi();
  const subtitle = document.getElementById('subtitle');
  const subscriptions = document.getElementById('subscriptions');
  const refreshBtn = document.getElementById('refresh-btn');
  const refreshIntervalInput = document.getElementById('refresh-interval');
  const resetAllBtn = document.getElementById('reset-all');

  refreshIntervalInput.addEventListener('change', () => {
    const value = Number(refreshIntervalInput.value);
    if (Number.isFinite(value) && value >= 10 && value <= 3600) {
      vscode.postMessage({ type: 'setRefreshInterval', value });
    }
  });

  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  resetAllBtn.addEventListener('click', () => {
    if (window.confirm('Clear all subscription names, visibility choices, and display order?')) {
      vscode.postMessage({ type: 'resetAll' });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') render(message.payload);
  });

  function render(state) {
    subtitle.textContent = formatSubtitle(state);
    refreshBtn.disabled = !!state.isLoading;
    refreshBtn.textContent = state.isLoading ? 'Refreshing…' : 'Refresh all';
    syncRefreshInterval(state.refreshInterval);

    subscriptions.replaceChildren();
    if (!state.subscriptions || state.subscriptions.length === 0) {
      subscriptions.appendChild(emptyState('Waiting for subscription usage…'));
      return;
    }

    for (const subscription of state.subscriptions) {
      subscriptions.appendChild(renderSubscription(subscription, state.isLoading));
    }
    enableSubscriptionReordering();
  }

  function renderSubscription(subscription, isLoading) {
    const card = document.createElement('article');
    card.className = `subscription-card subscription-${subscription.key}${subscription.hidden ? ' is-hidden' : ''}`;
    card.dataset.subscriptionKey = subscription.key;

    const header = document.createElement('div');
    header.className = 'subscription-header';

    const controls = document.createElement('div');
    controls.className = 'subscription-controls';
    const dragHandle = createDragHandle(
      'subscription-drag-handle',
      `Reorder ${subscription.customName || subscription.originalName}`
    );
    controls.appendChild(dragHandle);
    controls.appendChild(renderSwitch({
      checked: !subscription.hidden,
      title: subscription.hidden ? 'Show this subscription' : 'Hide this subscription from the status bar',
      onChange: (checked) => vscode.postMessage({
        type: 'setSubscriptionHidden',
        subscriptionKey: subscription.key,
        hidden: !checked
      })
    }));

    const logo = document.createElement('span');
    logo.className = 'subscription-logo';
    logo.textContent = subscriptionIcon(subscription.key);
    controls.appendChild(logo);

    const nameCell = document.createElement('div');
    nameCell.className = 'subscription-name-cell';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'subscription-name-input';
    nameInput.placeholder = subscription.originalName;
    nameInput.value = subscription.customName || '';
    nameInput.setAttribute('aria-label', `Custom name for ${subscription.originalName}`);
    nameInput.addEventListener('change', () => vscode.postMessage({
      type: 'renameSubscription',
      subscriptionKey: subscription.key,
      name: nameInput.value
    }));
    nameCell.appendChild(nameInput);
    const originalName = document.createElement('span');
    originalName.className = `original-name${subscription.customName ? '' : ' hidden'}`;
    originalName.textContent = subscription.originalName;
    nameCell.appendChild(originalName);
    controls.appendChild(nameCell);
    header.appendChild(controls);

    const hasContents = subscription.contents.length > 0;
    const isPending = isLoading && !hasContents && !subscription.error;
    const status = document.createElement('span');
    status.className = `status-badge ${isPending ? 'status-loading' : subscription.error ? (hasContents ? 'status-stale' : 'status-error') : 'status-ready'}`;
    status.textContent = isPending ? 'LOADING' : subscription.error ? (hasContents ? 'STALE' : 'UNAVAILABLE') : 'LIVE';
    header.appendChild(status);
    card.appendChild(header);

    const metadata = document.createElement('div');
    metadata.className = 'subscription-metadata';
    metadata.appendChild(metadataField('Account', subscription.account || '—'));
    metadata.appendChild(metadataField('Description', subscription.description || '—'));
    card.appendChild(metadata);

    const contentHeader = document.createElement('div');
    contentHeader.className = 'content-heading';
    const contentTitle = document.createElement('span');
    contentTitle.textContent = 'Quota contents';
    contentHeader.appendChild(contentTitle);
    const hint = document.createElement('span');
    hint.textContent = 'Drag to set status-bar order';
    contentHeader.appendChild(hint);
    card.appendChild(contentHeader);

    if (hasContents) {
      const list = document.createElement('ul');
      list.className = 'content-list';
      for (const content of subscription.contents) list.appendChild(renderContent(content));
      card.appendChild(list);
      enableContentReordering(list, subscription.key);
    } else {
      card.appendChild(emptyState('No quota data available.'));
    }

    if (subscription.error) {
      const error = document.createElement('div');
      error.className = 'inline-error';
      error.textContent = subscription.error;
      card.appendChild(error);
    }

    const footer = document.createElement('div');
    footer.className = 'subscription-footer';
    const source = document.createElement('span');
    source.textContent = subscription.source;
    footer.appendChild(source);
    const updated = document.createElement('span');
    updated.textContent = subscription.lastUpdatedAt
      ? `Updated ${formatRelative(subscription.lastUpdatedAt, true)}`
      : 'Not updated';
    footer.appendChild(updated);
    card.appendChild(footer);
    return card;
  }

  function renderContent(content) {
    const row = document.createElement('li');
    row.className = `content-row${content.hidden ? ' is-hidden' : ''}`;
    row.dataset.contentId = content.id;

    row.appendChild(createDragHandle(
      'content-drag-handle',
      `Reorder ${content.customName || content.originalLabel}`
    ));
    row.appendChild(renderSwitch({
      checked: !content.hidden,
      small: true,
      title: content.hidden ? 'Show this quota content' : 'Hide this quota content from the status bar',
      onChange: (checked) => vscode.postMessage({
        type: 'setContentHidden',
        contentId: content.id,
        hidden: !checked
      })
    }));

    const dot = document.createElement('span');
    dot.className = `dot${pctClass(content.remainingPercent)}`;
    row.appendChild(dot);

    const nameCell = document.createElement('div');
    nameCell.className = 'content-name-cell';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'content-name-input';
    nameInput.placeholder = content.originalLabel;
    nameInput.value = content.customName || '';
    nameInput.setAttribute('aria-label', `Custom name for ${content.originalLabel}`);
    nameInput.addEventListener('change', () => vscode.postMessage({
      type: 'renameContent',
      contentId: content.id,
      name: nameInput.value
    }));
    nameCell.appendChild(nameInput);
    const original = document.createElement('span');
    original.className = `original-name${content.customName ? '' : ' hidden'}`;
    original.textContent = content.originalLabel;
    nameCell.appendChild(original);
    row.appendChild(nameCell);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = `bar-fill${pctClass(content.remainingPercent)}`;
    fill.style.width = `${clampPercent(content.remainingPercent)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    const percentage = document.createElement('div');
    percentage.className = `pct-cell${pctClass(content.remainingPercent)}`;
    percentage.textContent = `${content.remainingPercent}%`;
    row.appendChild(percentage);

    const reset = document.createElement('div');
    reset.className = 'reset-cell';
    reset.textContent = content.resetTime ? formatReset(content.resetTime) : '—';
    row.appendChild(reset);
    return row;
  }

  function enableSubscriptionReordering() {
    enableReordering({
      container: subscriptions,
      rowSelector: '.subscription-card',
      handleSelector: '.subscription-drag-handle',
      idFromRow: (row) => row.dataset.subscriptionKey,
      onSave: (subscriptionKeys) => vscode.postMessage({ type: 'setSubscriptionOrder', subscriptionKeys })
    });
  }

  function enableContentReordering(list, subscriptionKey) {
    enableReordering({
      container: list,
      rowSelector: '.content-row',
      handleSelector: '.content-drag-handle',
      idFromRow: (row) => row.dataset.contentId,
      onSave: (contentIds) => vscode.postMessage({ type: 'setContentOrder', subscriptionKey, contentIds })
    });
  }

  function enableReordering({ container, rowSelector, handleSelector, idFromRow, onSave }) {
    let draggedRow = null;
    let startingOrder = [];
    const rows = () => [...container.querySelectorAll(`:scope > ${rowSelector}`)];
    const ids = () => rows().map(idFromRow).filter(Boolean);

    const clear = () => {
      if (draggedRow) draggedRow.classList.remove('is-dragging');
      draggedRow = null;
      startingOrder = [];
    };
    const restore = () => {
      const byId = new Map(rows().map((row) => [idFromRow(row), row]));
      for (const id of startingOrder) {
        const row = byId.get(id);
        if (row) container.appendChild(row);
      }
    };
    const save = () => {
      const nextOrder = ids();
      if (nextOrder.join('\u0000') !== startingOrder.join('\u0000')) onSave(nextOrder);
    };

    for (const row of rows()) {
      const handle = row.querySelector(handleSelector);
      handle.addEventListener('dragstart', (event) => {
        draggedRow = row;
        startingOrder = ids();
        row.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', idFromRow(row) || '');
      });
      handle.addEventListener('dragend', () => {
        if (!draggedRow) return;
        restore();
        clear();
      });
      handle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling) return;
        event.preventDefault();
        startingOrder = ids();
        if (event.key === 'ArrowUp') container.insertBefore(row, sibling);
        else container.insertBefore(sibling, row);
        save();
        startingOrder = [];
        handle.focus();
      });
    }

    container.addEventListener('dragover', (event) => {
      if (!draggedRow) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const target = event.target.closest(rowSelector);
      if (!target || target.parentElement !== container) {
        container.appendChild(draggedRow);
        return;
      }
      if (target === draggedRow) return;
      const bounds = target.getBoundingClientRect();
      container.insertBefore(draggedRow, event.clientY > bounds.top + bounds.height / 2 ? target.nextSibling : target);
    });
    container.addEventListener('drop', (event) => {
      if (!draggedRow) return;
      event.preventDefault();
      save();
      clear();
    });
  }

  function createDragHandle(className, label) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `drag-handle ${className}`;
    handle.draggable = true;
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder; use arrow keys for keyboard control';
    handle.setAttribute('aria-label', label);
    return handle;
  }

  function renderSwitch({ checked, onChange, title, small }) {
    const label = document.createElement('label');
    label.className = `switch${small ? ' switch-sm' : ''}`;
    if (title) label.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.setAttribute('role', 'switch');
    input.addEventListener('change', () => onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.appendChild(input);
    label.appendChild(slider);
    return label;
  }

  function metadataField(label, value) {
    const field = document.createElement('div');
    field.className = 'metadata-field';
    const labelElement = document.createElement('span');
    labelElement.className = 'field-label';
    labelElement.textContent = label;
    field.appendChild(labelElement);
    const valueElement = document.createElement('span');
    valueElement.className = 'field-value';
    valueElement.textContent = value;
    field.appendChild(valueElement);
    return field;
  }

  function subscriptionIcon(key) {
    if (key === 'antigravity') return 'A';
    if (key === 'claude-code') return 'C';
    return '⌘';
  }

  function emptyState(text) {
    const element = document.createElement('div');
    element.className = 'empty';
    element.textContent = text;
    return element;
  }

  function pctClass(percent) {
    if (percent <= 10) return ' crit';
    if (percent <= 30) return ' warn';
    return '';
  }

  function clampPercent(percent) {
    return Math.max(0, Math.min(100, percent));
  }

  function formatSubtitle(state) {
    if (state.isLoading && !state.lastUpdatedAt) return 'Reading local subscription sources…';
    if (state.isLoading) return 'Refreshing all sources…';
    if (state.lastUpdatedAt) return `Last full refresh ${formatRelative(state.lastUpdatedAt, true)}`;
    return 'Ready';
  }

  function formatReset(iso) {
    const resetDate = new Date(iso);
    const target = resetDate.getTime();
    if (!Number.isFinite(target)) return iso;
    const diffMs = target - Date.now();
    if (diffMs <= 0) return 'available';
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const absolute = `${resetDate.getMonth() + 1}/${resetDate.getDate()} ${pad(resetDate.getHours())}:${pad(resetDate.getMinutes())}`;
    const relative = days > 0
      ? `${days}d ${hours % 24}h`
      : hours > 0
        ? `${hours}h ${minutes % 60}m`
        : `${minutes}m`;
    return `${relative} · ${absolute}`;
  }

  function formatRelative(iso, past) {
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return iso;
    const diffMs = target - Date.now();
    const ago = past || diffMs <= 0;
    const absolute = Math.abs(diffMs);
    const minutes = Math.floor(absolute / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const label = days > 0
      ? `${days}d ${hours % 24}h`
      : hours > 0
        ? `${hours}h ${minutes % 60}m`
        : minutes > 0
          ? `${minutes}m`
          : `${Math.max(1, Math.floor(absolute / 1000))}s`;
    return ago ? `${label} ago` : `in ${label}`;
  }

  function syncRefreshInterval(refreshInterval) {
    if (document.activeElement !== refreshIntervalInput) refreshIntervalInput.value = refreshInterval;
  }

  function pad(value) {
    return value < 10 ? `0${value}` : String(value);
  }
})();
