document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const btnTrigger = document.getElementById('btn-trigger');
  const btnClearConsole = document.getElementById('btn-clear-console');
  const btnSimulateCallback = document.getElementById('btn-simulate-callback');
  const consoleLogs = document.getElementById('console-logs');
  const vendorSelect = document.getElementById('vendor-select');
  const breachSelect = document.getElementById('breach-select');
  const customVendorGroup = document.getElementById('custom-vendor-group');
  const customVendorInput = document.getElementById('custom-vendor-input');
  const customQueryInput = document.getElementById('custom-query-input');
  const scrapeUrlInput = document.getElementById('scrape-url-input');
  const companyScrapeInput = document.getElementById('company-scrape-input');
  
  // Pipeline Nodes
  const nodes = {
    threat: document.getElementById('node-threat-intel'),
    risk: document.getElementById('node-risk-assess'),
    enrich: document.getElementById('node-gtm-enrich'),
    outreach: document.getElementById('node-outreach')
  };
  
  const connectors = {
    c1: document.getElementById('connector-1'),
    c2: document.getElementById('connector-2'),
    c3: document.getElementById('connector-3')
  };

  // Details Panes
  const threatJson = document.getElementById('threat-json');
  const threatLayman = document.getElementById('threat-layman-view');
  const riskJson = document.getElementById('risk-json');
  const riskLayman = document.getElementById('risk-layman-view');
  const riskScoreValue = document.getElementById('risk-score-value');
  const riskSeverityBadge = document.getElementById('risk-severity-badge');
  const scrapeJobPanel = document.getElementById('scrape-job-panel');
  const brightdataJobIdDisplay = document.getElementById('brightdata-job-id-display');
  const enrichmentJson = document.getElementById('enrichment-json');
  const enrichmentLayman = document.getElementById('enrichment-layman-view');
  const outreachContainer = document.getElementById('outreach-drafts-container');

  // State
  let currentRecordId = null;
  let activeJobId = null;
  let pollingInterval = null;

  // Tab Logic
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.remove('hidden');
    });
  });

  // Toggle Developer JSON display
  document.querySelectorAll('.toggle-json-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.classList.toggle('hidden');
        btn.textContent = targetEl.classList.contains('hidden')
          ? '🔍 Toggle Developer JSON'
          : '👁️ Hide Developer JSON';
      }
    });
  });

  // Console Log Helper
  function log(message, type = 'muted') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.textContent = `[${time}] ${message}`;
    consoleLogs.appendChild(line);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  // Clear Console
  btnClearConsole.addEventListener('click', () => {
    consoleLogs.innerHTML = '';
    log('Console cleared.', 'muted');
  });

  // Start Polling for Pipeline Record updates
  function startPolling(recordId) {
    if (pollingInterval) clearInterval(pollingInterval);
    
    pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline?recordId=${recordId}`);
        if (!res.ok) return;
        
        const data = await res.json();
        updateUIState(data);
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  // Simulated real-time progression for stateless serverless environments
  async function animateLocalRecord(record) {
    stopPolling();
    const statuses = ['RAW_DETECTED', 'RISK_QUALIFIED', 'TARGETS_ENRICHED', 'OUTREACH_GENERATED'];
    
    const finalStatus = record.status || 'OUTREACH_GENERATED';
    const finalIndex = statuses.indexOf(finalStatus);
    const stepsToAnimate = finalIndex >= 0 ? statuses.slice(0, finalIndex + 1) : [finalStatus];
    
    for (const status of stepsToAnimate) {
      const tempRecord = JSON.parse(JSON.stringify(record));
      tempRecord.status = status;
      
      if (status === 'RAW_DETECTED') {
        tempRecord.risk_analysis = null;
        tempRecord.risk_score = null;
        tempRecord.enriched_targets = null;
        tempRecord.outreach_drafts = null;
        log('Agent 1: Threat Intelligence Scan completed.', 'success');
      } else if (status === 'RISK_QUALIFIED') {
        tempRecord.enriched_targets = null;
        tempRecord.outreach_drafts = null;
        log('Agent 2: Risk Assessment evaluation completed.', 'success');
      } else if (status === 'TARGETS_ENRICHED') {
        tempRecord.outreach_drafts = null;
        log('Agent 3: GTM Enrichment completed.', 'success');
      } else if (status === 'OUTREACH_GENERATED') {
        log('Agent 4: Outreach compiler completed. Pipeline finished!', 'success');
      } else if (status === 'FAILED') {
        log('Pipeline execution failed.', 'danger');
      }
      
      updateUIState(tempRecord);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Render the final record to ensure all panels are fully updated
    updateUIState(record);
  }

  // Update visual elements depending on active pipeline status
  function updateUIState(record) {
    if (!record) return;

    // Normalize keys to support both camelCase and snake_case API response formats
    const status = record.status;
    const threatPayload = record.threat_payload || record.threatPayload;
    const threatSource = record.threatSource || record.threat_source || 'Bright Data intelligence feed';
    const riskAnalysis = record.risk_analysis || record.riskAnalysis;
    const riskScore = record.risk_score !== undefined ? record.risk_score : (record.riskScore !== undefined ? record.riskScore : null);
    const brightdataJobId = record.brightdata_job_id || record.brightdataJobId;
    const enrichedTargets = record.enriched_targets || record.enrichedTargets;
    const outreachDrafts = record.outreach_drafts || record.outreachDrafts;

    // A. Update details panels
    if (threatPayload) {
      threatJson.textContent = JSON.stringify(threatPayload, null, 2);
      
      const payload = threatPayload;
      threatLayman.innerHTML = `
        <div class="layman-card">
          <h4>🚨 Security Incident Report</h4>
          <div class="layman-grid">
            <div class="layman-prop">
              <span class="layman-prop-label">Target Company/Vendor</span>
              <span class="layman-prop-value">${payload.vendor || 'N/A'}</span>
            </div>
            <div class="layman-prop">
              <span class="layman-prop-label">Detected Threat Date</span>
              <span class="layman-prop-value">${payload.detectedAt || 'N/A'}</span>
            </div>
            <div class="layman-prop">
              <span class="layman-prop-label">Source System</span>
              <span class="layman-prop-value" style="color: var(--primary);">${threatSource}</span>
            </div>
          </div>
          <div class="layman-desc">
            <strong>Description:</strong> ${payload.description || 'No description provided.'}
          </div>
        </div>
      `;
    } else {
      threatJson.textContent = 'No threat detected yet. Run the simulation to view the raw threat payload.';
      threatLayman.innerHTML = `<p class="text-muted">No threat detected yet. Run the simulation to view threat report.</p>`;
    }
    
    if (riskAnalysis) {
      riskJson.textContent = JSON.stringify(riskAnalysis, null, 2);
      riskScoreValue.textContent = riskScore !== null ? riskScore : '-';
      
      const severity = riskAnalysis.severity || 'NONE';
      riskSeverityBadge.textContent = severity;
      riskSeverityBadge.className = 'badge';
      if (severity === 'CRITICAL') riskSeverityBadge.classList.add('badge-danger');
      else if (severity === 'HIGH') riskSeverityBadge.classList.add('badge-warning');
      else riskSeverityBadge.classList.add('badge-success');

      const analysis = riskAnalysis;
      const chips = (analysis.complianceImpacts || [])
        .map(c => `<span class="compliance-chip">${c}</span>`)
        .join(' ');

      riskLayman.innerHTML = `
        <div class="layman-card">
          <h4>⚖️ Impact Evaluation</h4>
          <div class="layman-grid">
            <div class="layman-prop">
              <span class="layman-prop-label">Evaluated Score</span>
              <span class="layman-prop-value" style="font-size: 1.2rem; font-weight: bold; color: ${severity === 'CRITICAL' ? '#ef4444' : severity === 'HIGH' ? '#f97316' : '#10b981'}">${riskScore !== null ? riskScore : '-'}/100</span>
            </div>
            <div class="layman-prop">
              <span class="layman-prop-label">Regulatory Standards Affected</span>
              <div class="compliance-chips">${chips || '<span class="text-muted">None</span>'}</div>
            </div>
          </div>
          <div class="layman-desc" style="border-left-color: #8b5cf6;">
            <strong>Executive Justification:</strong> ${analysis.justification || 'No evaluation details provided.'}
          </div>
        </div>
      `;
    } else {
      riskJson.textContent = 'Awaiting risk assessor execution...';
      riskScoreValue.textContent = '-';
      riskSeverityBadge.textContent = 'None';
      riskSeverityBadge.className = 'badge';
      riskLayman.innerHTML = `<p class="text-muted">Awaiting risk assessor evaluation...</p>`;
    }

    if (brightdataJobId) {
      activeJobId = brightdataJobId;
      brightdataJobIdDisplay.textContent = activeJobId;
      scrapeJobPanel.classList.remove('hidden');
    } else {
      scrapeJobPanel.classList.add('hidden');
    }

    if (enrichedTargets && enrichedTargets.length > 0) {
      enrichmentJson.textContent = JSON.stringify(enrichedTargets, null, 2);

      const rows = enrichedTargets.map(target => {
        const primaryContact = target.contacts?.[0] || { name: 'IT Security Lead', role: 'Security Manager', email: 'security@company.com' };
        const tags = (target.techStackSignals || [])
          .map(t => `<span class="tech-tag">${t}</span>`)
          .join('');
        return `
          <tr>
            <td>
              <strong>${target.companyName}</strong><br>
              <a href="${target.domain}" target="_blank" style="font-size: 0.75rem; color: var(--primary); text-decoration: none;">${target.domain}</a>
            </td>
            <td>${tags || '<span class="text-muted">No signals</span>'}</td>
            <td>
              <strong>${primaryContact.name}</strong><br>
              <span style="font-size: 0.75rem; color: var(--text-muted);">${primaryContact.role}</span>
            </td>
            <td>
              <code style="color: #c084fc; font-size: 0.75rem;">${primaryContact.email}</code>
            </td>
          </tr>
        `;
      }).join('');

      enrichmentLayman.innerHTML = `
        <div class="layman-table-wrapper" style="margin-top: 1rem;">
          <table class="layman-table">
            <thead>
              <tr>
                <th>Customer / Account</th>
                <th>Tech Signals</th>
                <th>Target Contact</th>
                <th>Outreach Channel</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    } else {
      enrichmentJson.textContent = 'Awaiting target enrichment execution...';
      enrichmentLayman.innerHTML = `<p class="text-muted">Awaiting target enrichment execution...</p>`;
    }

    if (outreachDrafts && outreachDrafts.length > 0) {
      outreachContainer.innerHTML = '';
      outreachDrafts.forEach(draft => {
        const card = document.createElement('div');
        card.className = 'outreach-card';
        card.innerHTML = `
          <div class="outreach-meta">
            <span>To: <strong>${draft.contactName}</strong> (${draft.contactEmail})</span>
            <span class="badge badge-success">READY</span>
          </div>
          <div class="outreach-subject">Subject: ${draft.emailSubject}</div>
          <pre class="outreach-body">${draft.emailBody}</pre>
        `;
        outreachContainer.appendChild(card);
      });
    }

    // B. Update Agent Nodes
    resetVisualizer();

    if (status === 'RAW_DETECTED') {
      setNodeState('threat', 'completed');
      setConnectorState('c1', 'active');
      setNodeState('risk', 'active');
    } 
    else if (status === 'RISK_QUALIFIED') {
      setNodeState('threat', 'completed');
      setConnectorState('c1', 'completed');
      setNodeState('risk', 'completed');
      setConnectorState('c2', 'active');
      setNodeState('enrich', 'active');
    } 
    else if (status === 'TARGETS_ENRICHED') {
      setNodeState('threat', 'completed');
      setConnectorState('c1', 'completed');
      setNodeState('risk', 'completed');
      setConnectorState('c2', 'completed');
      setNodeState('enrich', 'completed');
      setConnectorState('c3', 'active');
      setNodeState('outreach', 'active');
    } 
    else if (status === 'OUTREACH_GENERATED') {
      setNodeState('threat', 'completed');
      setConnectorState('c1', 'completed');
      setNodeState('risk', 'completed');
      setConnectorState('c2', 'completed');
      setNodeState('enrich', 'completed');
      setConnectorState('c3', 'completed');
      setNodeState('outreach', 'completed');
      stopPolling();
      log('Pipeline flow execution completed successfully.', 'success');
    } 
    else if (status === 'FAILED') {
      setNodeState('threat', 'failed');
      stopPolling();
      log('Pipeline failed during execution.', 'danger');
    }
  }

  function resetVisualizer() {
    Object.keys(nodes).forEach(k => {
      nodes[k].className = 'step-node';
      nodes[k].querySelector('.node-status').textContent = 'Idle';
    });
    Object.keys(connectors).forEach(k => {
      connectors[k].className = 'step-connector';
    });
  }

  function setNodeState(nodeKey, state) {
    const el = nodes[nodeKey];
    if (!el) return;
    el.classList.add(state);
    el.querySelector('.node-status').textContent = state;
  }

  function setConnectorState(connKey, state) {
    const el = connectors[connKey];
    if (!el) return;
    el.classList.add(state);
  }

  // Toggle custom vendor field
  vendorSelect.addEventListener('change', () => {
    if (vendorSelect.value) {
      // Clear company scrape input and reset hint
      companyScrapeInput.value = '';
      const hint = document.querySelector('.company-scrape-group .input-hint');
      if (hint) hint.innerHTML = 'Type any company name — pipeline will search, enrich, and generate outreach automatically.';
      
      // Auto-fill query based on select
      if (vendorSelect.value !== 'CUSTOM') {
        customQueryInput.value = `${vendorSelect.value} data breach security advisory vulnerability`;
      }
    }

    if (vendorSelect.value === 'CUSTOM') {
      customVendorGroup.classList.remove('hidden');
    } else {
      customVendorGroup.classList.add('hidden');
    }
  });

  let resolveUrlTimeout = null;

  // Auto-fill the SERP query and resolve official URL using DeepSeek when company name is typed
  companyScrapeInput.addEventListener('input', () => {
    const company = companyScrapeInput.value.trim();
    if (company) {
      customQueryInput.value = `${company} data breach security advisory vulnerability`;
      // Clear preset select so company input takes priority
      vendorSelect.value = '';
      customVendorGroup.classList.add('hidden');

      // Debounce DeepSeek URL Resolution lookup to avoid excessive API requests
      if (resolveUrlTimeout) clearTimeout(resolveUrlTimeout);
      
      const hint = document.querySelector('.company-scrape-group .input-hint');
      if (hint) hint.innerHTML = '🔍 Resolving official website URL using DeepSeek...';

      resolveUrlTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/resolve-url?company=${encodeURIComponent(company)}`);
          if (!res.ok) throw new Error('Failed to resolve URL');
          const data = await res.json();
          if (data.url) {
            scrapeUrlInput.value = data.url;
            if (hint) hint.innerHTML = `✅ DeepSeek resolved official URL: <strong style="color: var(--primary);">${data.url}</strong>`;
            log(`DeepSeek resolved company URL for "${company}": ${data.url}`, 'info');
          }
        } catch (err) {
          console.error('URL resolution failed:', err);
          if (hint) hint.innerHTML = '⚠️ Custom query set. Type target website URL below if needed.';
        }
      }, 1200); // 1.2s debounce
    } else {
      if (resolveUrlTimeout) clearTimeout(resolveUrlTimeout);
      const hint = document.querySelector('.company-scrape-group .input-hint');
      if (hint) hint.innerHTML = 'Type any company name — pipeline will search, enrich, and generate outreach automatically.';
    }
  });

  // Action: Trigger Threat Breach
  btnTrigger.addEventListener('click', async () => {
    // Company input takes priority over preset select
    const companyInput = companyScrapeInput.value.trim();
    const vendor = companyInput
      ? companyInput
      : vendorSelect.value === 'CUSTOM'
        ? customVendorInput.value
        : vendorSelect.value || 'AcmeCloud Corp';
    const customQuery = customQueryInput.value;
    const scrapeUrl = scrapeUrlInput.value;
    const severity = breachSelect.value;
    
    log(`Triggering Threat Monitor Scan for vendor: "${vendor}"...`, 'info');
    
    // Reset visualizer and buttons
    resetVisualizer();
    setNodeState('threat', 'active');
    btnTrigger.disabled = true;

    try {
      const res = await fetch('/api/cron/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          customVendor: vendor, 
          customQuery, 
          scrapeUrl, 
          simulateSeverity: severity 
        })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || 'Trigger failed');
      }

      currentRecordId = data.recordId;
      log(`State machine pipeline initiated. DB record: ${currentRecordId}`, 'success');
      
      if (data.record) {
        animateLocalRecord(data.record);
      } else {
        startPolling(currentRecordId);
      }

    } catch (err) {
      log(`Trigger error: ${err.message}`, 'danger');
      setNodeState('threat', 'failed');
    } finally {
      btnTrigger.disabled = false;
    }
  });

  // Action: Force Scraper Callback
  btnSimulateCallback.addEventListener('click', async () => {
    if (!currentRecordId || !activeJobId) {
      log('No active pipeline job to callback.', 'warning');
      return;
    }

    log(`Simulating Bright Data scraping callback for job: ${activeJobId}...`, 'info');
    btnSimulateCallback.disabled = true;

    const mockResults = [
      {
        companyName: 'ShieldedTech Solutions',
        domain: 'https://shieldedtech.com',
        techStackSignals: ['Next.js', 'Vercel', 'PostgreSQL'],
        contacts: [
          { name: 'Bruce Wayne', role: 'CISO Officer', email: 'bwayne@shieldedtech.com' }
        ]
      },
      {
        companyName: 'NovaBank Corp',
        domain: 'https://novabank.com',
        techStackSignals: ['Okta', 'React'],
        contacts: [
          { name: 'Diana Prince', role: 'Head of Information Security', email: 'dprince@novabank.com' }
        ]
      }
    ];

    try {
      const res = await fetch(`/api/webhook/enrich?source=brightdata&recordId=${currentRecordId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: activeJobId,
          results: mockResults
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Callback simulation failed');
      }

      log('Bright Data callback accepted. State Machine progressing...', 'success');
    } catch (err) {
      log(`Callback error: ${err.message}`, 'danger');
    } finally {
      btnSimulateCallback.disabled = false;
    }
  });

});
