(function () {
  const vscode = acquireVsCodeApi();

  const subtitle = document.getElementById('subtitle');
  const content = document.getElementById('content');
  const refreshBtn = document.getElementById('refresh-btn');
  const resetAllBtn = document.getElementById('reset-all');
  const creditsEl = document.getElementById('credits');
  const creditsValueEl = document.getElementById('credits-value');

  // Premium elements for Plan Details
  const planCard = document.getElementById('plan-card');
  const planBadgeName = document.getElementById('plan-badge-name');
  const planGrid = document.getElementById('plan-grid');
  const planUpgradeBanner = document.getElementById('plan-upgrade-banner');
  const upgradeMessage = document.getElementById('upgrade-message');
  const upgradeLink = document.getElementById('upgrade-link');
  const toggleDataBtn = document.getElementById('toggle-data-btn');
  const toggleExpandBtn = document.getElementById('toggle-expand-btn');

  // Premium elements for Settings Card
  const settingsCard = document.getElementById('settings-card');
  const settingShowCreditsContainer = document.getElementById('setting-show-credits-container');
  const settingRefreshInterval = document.getElementById('setting-refresh-interval');

  let isDataHidden = localStorage.getItem('isDataHidden') === 'true';
  let isExpanded = localStorage.getItem('isPlanExpanded') === 'true';
  let lastPlanState = null;

  // Initial UI state setup
  updateToggleDataBtn();
  updateExpandState();

  // Listen for refresh interval changes
  settingRefreshInterval.addEventListener('change', () => {
    const val = parseInt(settingRefreshInterval.value, 10);
    if (!isNaN(val) && val >= 10 && val <= 3600) {
      vscode.postMessage({ type: 'setRefreshInterval', value: val });
    }
  });

  toggleDataBtn.addEventListener('click', () => {
    isDataHidden = !isDataHidden;
    localStorage.setItem('isDataHidden', isDataHidden);
    updateToggleDataBtn();
    if (lastPlanState) {
      renderPlanDetails(lastPlanState);
    }
  });

  function updateToggleDataBtn() {
    toggleDataBtn.textContent = isDataHidden ? 'Show Data' : 'Hide Data';
  }

  toggleExpandBtn.addEventListener('click', () => {
    isExpanded = !isExpanded;
    localStorage.setItem('isPlanExpanded', isExpanded);
    updateExpandState();
  });

  function updateExpandState() {
    if (isExpanded) {
      planGrid.classList.remove('is-collapsed');
      toggleExpandBtn.innerHTML = 'Show Less <span class="arrow">▲</span>';
    } else {
      planGrid.classList.add('is-collapsed');
      toggleExpandBtn.innerHTML = 'Show More <span class="arrow">▼</span>';
    }
  }

  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  resetAllBtn.addEventListener('click', () => {
    if (window.confirm('Clear all custom names and show every family/model?')) {
      vscode.postMessage({ type: 'resetAll' });
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'state') render(msg.payload);
  });

  function render(state) {
    subtitle.textContent = formatSubtitle(state);
    if (state.credits != null) {
      creditsValueEl.textContent = state.credits.toLocaleString('en-US');
      creditsEl.hidden = false;
    } else {
      creditsEl.hidden = true;
    }

    renderPlanDetails(state.plan);
    renderSettings(state.showCredits, state.refreshInterval);

    content.replaceChildren();

    if (state.error && state.groups.length === 0) {
      content.appendChild(banner(state.error));
      return;
    }

    if (state.error) {
      content.appendChild(banner(`Last refresh failed: ${state.error}. Showing last-known data.`));
    }

    if (state.groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.isLoading ? 'Loading…' : 'No model quota data available.';
      content.appendChild(empty);
      return;
    }

    for (const group of state.groups) content.appendChild(renderFamily(group));
  }

  function renderFamily(group) {
    const section = document.createElement('section');
    section.className = 'family' + (group.hidden ? ' is-hidden' : '');

    const header = document.createElement('div');
    header.className = 'family-header';

    const visibilitySwitch = renderSwitch({
      checked: !group.hidden,
      title: group.hidden
        ? 'Show this family in the status bar and tooltip'
        : 'Hide this family from the status bar and tooltip',
      onChange: (checked) => {
        vscode.postMessage({
          type: 'setGroupHidden',
          groupKey: group.key,
          hidden: !checked
        });
      }
    });
    header.appendChild(visibilitySwitch);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'family-name-input';
    nameInput.placeholder = group.autoName;
    nameInput.value = group.customName || '';
    nameInput.addEventListener('change', () => {
      vscode.postMessage({ type: 'renameGroup', groupKey: group.key, name: nameInput.value });
    });
    header.appendChild(nameInput);

    const stats = document.createElement('div');
    stats.className = 'family-stats';
    const pct = document.createElement('span');
    pct.className = 'pct' + pctClass(group.minRemainingPercent);
    pct.textContent = `${group.minRemainingPercent}%`;
    stats.appendChild(document.createTextNode('min '));
    stats.appendChild(pct);
    header.appendChild(stats);

    section.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'model-list';
    for (const member of group.members) list.appendChild(renderMember(member));
    section.appendChild(list);

    return section;
  }

  function renderMember(member) {
    const row = document.createElement('li');
    row.className = 'model-row' + (member.hidden ? ' is-hidden' : '');

    const visibilitySwitch = renderSwitch({
      checked: !member.hidden,
      small: true,
      title: member.hidden
        ? 'Show this model in the status bar and tooltip'
        : 'Hide this model from the status bar and tooltip',
      onChange: (checked) => {
        vscode.postMessage({
          type: 'setModelHidden',
          modelId: member.modelId,
          hidden: !checked
        });
      }
    });
    row.appendChild(visibilitySwitch);

    const dot = document.createElement('span');
    dot.className = 'dot' + pctClass(member.remainingPercent);
    row.appendChild(dot);

    const nameCell = document.createElement('div');
    nameCell.className = 'model-name-cell';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'model-name-input';
    nameInput.placeholder = member.originalLabel;
    nameInput.value = member.customName || '';
    nameInput.addEventListener('change', () => {
      vscode.postMessage({ type: 'renameModel', modelId: member.modelId, name: nameInput.value });
    });
    nameCell.appendChild(nameInput);
    const original = document.createElement('span');
    original.className = 'model-original';
    if (member.customName && member.customName !== member.originalLabel) {
      original.textContent = member.originalLabel;
    } else {
      original.classList.add('hidden');
    }
    nameCell.appendChild(original);
    row.appendChild(nameCell);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'bar-fill' + pctClass(member.remainingPercent);
    fill.style.width = `${Math.max(0, Math.min(100, member.remainingPercent))}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    const pctCell = document.createElement('div');
    pctCell.className = 'pct-cell' + pctClass(member.remainingPercent);
    pctCell.textContent = `${member.remainingPercent}%`;
    row.appendChild(pctCell);

    const resetCell = document.createElement('div');
    resetCell.className = 'reset-cell';
    resetCell.textContent = member.resetTime ? formatReset(member.resetTime) : '—';
    row.appendChild(resetCell);

    return row;
  }

  function renderSwitch({ checked, onChange, title, small }) {
    const label = document.createElement('label');
    label.className = 'switch' + (small ? ' switch-sm' : '');
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

  function pctClass(pct) {
    if (pct <= 10) return ' crit';
    if (pct <= 30) return ' warn';
    return '';
  }

  function banner(text) {
    const el = document.createElement('div');
    el.className = 'error-banner';
    el.textContent = text;
    return el;
  }

  function formatSubtitle(state) {
    if (state.isLoading && !state.lastUpdatedAt) return 'Loading…';
    if (state.lastUpdatedAt) return `Last updated ${formatRelative(state.lastUpdatedAt, true)}`;
    if (state.error) return 'Not available';
    return '';
  }

  function formatReset(iso) {
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return iso;
    const diffMs = target - Date.now();
    if (diffMs <= 0) return 'available';
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const hhmm = `${pad(hours % 24)}:${pad(minutes % 60)}`;
    let prefix;
    if (days > 0) prefix = `${days}d ${hours % 24}h`;
    else if (hours > 0) prefix = `${hours}h ${minutes % 60}m`;
    else prefix = `${minutes}m`;
    return `${prefix} (${hhmm})`;
  }

  function pad(n) { return n < 10 ? `0${n}` : `${n}`; }

  function formatRelative(iso, past) {
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return iso;
    const diffMs = target - Date.now();
    const ago = past || diffMs <= 0;
    const abs = Math.abs(diffMs);
    const minutes = Math.floor(abs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    let label;
    if (days > 0) label = `${days}d ${hours % 24}h`;
    else if (hours > 0) label = `${hours}h ${minutes % 60}m`;
    else if (minutes > 0) label = `${minutes}m`;
    else label = `${Math.max(1, Math.floor(abs / 1000))}s`;
    return ago ? `${label} ago` : `in ${label}`;
  }

  function renderPlanDetails(plan) {
    if (!plan) {
      planCard.hidden = true;
      return;
    }

    lastPlanState = plan;

    // 1. Render Plan Card Header
    planCard.hidden = false;
    planBadgeName.textContent = plan.planName || 'GOOGLE AI PRO';

    // 3. Render Upgrade Banner
    if (plan.upgradeUrl) {
      upgradeLink.href = plan.upgradeUrl;
      upgradeMessage.textContent = plan.upgradeMessage || 'You can upgrade to the Google AI Ultra plan to receive the highest rate limits.';
      planUpgradeBanner.hidden = false;
    } else {
      planUpgradeBanner.hidden = true;
    }

    // 4. Render Grid Items
    planGrid.replaceChildren();

    const items = [
      { label: 'Email', value: plan.email, isSensitive: true, primary: true },
      { label: 'Description', value: plan.description, primary: true },
      { label: 'Teams Tier', value: plan.features.teamsTier, primary: true },
      { label: 'Internal Tier ID', value: plan.features.internalTierId, primary: true },
      { label: 'Context Window', value: plan.features.contextWindow, primary: true },
      { label: 'Chat Instructions Char Limit', value: plan.features.chatInstructionsCharLimit },
      { label: 'Max Premium Msgs', value: plan.features.maxPremiumMsgs },
      { label: 'Pinned Context Items', value: plan.features.pinnedContextItems },
      { label: 'Local Index Size', value: plan.features.localIndexSize },
      { label: 'Web Search', value: plan.features.webSearch, isBool: true },
      { label: 'Browser Access', value: plan.features.browserAccess, isBool: true },
      { label: 'Knowledge Base', value: plan.features.knowledgeBase, isBool: true },
      { label: 'MCP Servers', value: plan.features.mcpServers, isBool: true, primary: true },
      { label: 'Git Commit Gen', value: plan.features.gitCommitGen, isBool: true },
      { label: 'Autocomplete Fast Mode', value: plan.features.autocompleteFastMode, isBool: true },
      { label: 'Can Buy Credits', value: plan.features.canBuyCredits, isBool: true },
      { label: 'Tab To Jump', value: plan.features.tabToJump, isBool: true },
      { label: 'Sticky Models', value: plan.features.stickyModels, isBool: true },
      { label: 'Command Models', value: plan.features.commandModels, isBool: true },
      { label: 'Accepted TOS', value: plan.features.acceptedTos, isBool: true },
      { label: 'Customize Icon', value: plan.features.customizeIcon, isBool: true },
      { label: 'Cascade Auto Run', value: plan.features.cascadeAutoRun, isBool: true },
      { label: 'Cascade Background', value: plan.features.cascadeBackground, isBool: true },
      { label: 'Auto Run Commands', value: plan.features.autoRunCommands, isBool: true },
      { label: 'Exp. Browser Features', value: plan.features.expBrowserFeatures, isBool: true }
    ];

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'grid-item' + (item.primary ? '' : ' grid-item-extra');

      const labelEl = document.createElement('span');
      labelEl.className = 'grid-label';
      labelEl.textContent = item.label;
      el.appendChild(labelEl);

      const valEl = document.createElement('span');
      let displayValue = item.value;

      if (item.isSensitive && isDataHidden) {
        if (typeof displayValue === 'string' && displayValue.includes('@')) {
          const parts = displayValue.split('@');
          const first = parts[0];
          const visible = first.length > 2 ? first.slice(0, 2) : first;
          displayValue = visible + '••••••••@' + parts[1];
        } else {
          displayValue = '••••••••';
        }
      }

      if (item.isBool) {
        valEl.className = displayValue ? 'grid-value badge-enabled' : 'grid-value badge-disabled';
        valEl.textContent = displayValue ? 'Enabled' : 'Disabled';
      } else {
        valEl.className = 'grid-value text';
        valEl.textContent = displayValue !== undefined && displayValue !== null ? displayValue.toString() : '—';
      }

      el.appendChild(valEl);
      planGrid.appendChild(el);
    }
  }

  function renderSettings(showCredits, refreshInterval) {
    settingsCard.hidden = false;

    // Render Show Credits Switch
    settingShowCreditsContainer.replaceChildren();
    const switchEl = renderSwitch({
      checked: showCredits,
      small: true,
      onChange: (checked) => {
        vscode.postMessage({ type: 'setShowCredits', value: checked });
      }
    });
    settingShowCreditsContainer.appendChild(switchEl);

    // Update Refresh Interval Input (if user is not currently typing)
    if (document.activeElement !== settingRefreshInterval) {
      settingRefreshInterval.value = refreshInterval;
    }
  }
})();
