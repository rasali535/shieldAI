document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const btnTrigger = document.getElementById('btn-trigger');
  const btnClearConsole = document.getElementById('btn-clear-console');
  const btnSimulateCallback = document.getElementById('btn-simulate-callback');
  const consoleLogs = document.getElementById('console-logs');
  const vendorSelect = document.getElementById('vendor-select');
  const breachSelect = document.getElementById('breach-select');
  
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
  const riskJson = document.getElementById('risk-json');
  const riskScoreValue = document.getElementById('risk-score-value');
  const riskSeverityBadge = document.getElementById('risk-severity-badge');
  const scrapeJobPanel = document.getElementById('scrape-job-panel');
  const brightdataJobIdDisplay = document.getElementById('brightdata-job-id-display');
  const enrichmentJson = document.getElementById('enrichment-json');
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

  // Update visual elements depending on active pipeline status
  function updateUIState(record) {
    if (!record) return;

    // A. Update details panels
    if (record.threat_payload) {
      threatJson.textContent = JSON.stringify(record.threat_payload, null, 2);
    }
    
    if (record.risk_analysis) {
      riskJson.textContent = JSON.stringify(record.risk_analysis, null, 2);
      riskScoreValue.textContent = record.risk_score || '-';
      
      const severity = record.risk_analysis.severity || 'NONE';
      riskSeverityBadge.textContent = severity;
      riskSeverityBadge.className = 'badge';
      if (severity === 'CRITICAL') riskSeverityBadge.classList.add('badge-danger');
      else if (severity === 'HIGH') riskSeverityBadge.classList.add('badge-warning');
      else riskSeverityBadge.classList.add('badge-success');
    }

    if (record.brightdata_job_id) {
      activeJobId = record.brightdata_job_id;
      brightdataJobIdDisplay.textContent = activeJobId;
      scrapeJobPanel.classList.remove('hidden');
    } else {
      scrapeJobPanel.classList.add('hidden');
    }

    if (record.enriched_targets && record.enriched_targets.length > 0) {
      enrichmentJson.textContent = JSON.stringify(record.enriched_targets, null, 2);
    } else {
      enrichmentJson.textContent = 'Awaiting callback data...';
    }

    if (record.outreach_drafts && record.outreach_drafts.length > 0) {
      outreachContainer.innerHTML = '';
      record.outreach_drafts.forEach(draft => {
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
    const status = record.status;
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

  // Action: Trigger Threat Breach
  btnTrigger.addEventListener('click', async () => {
    const vendor = vendorSelect.value;
    const severity = breachSelect.value;
    
    log(`Triggering Threat Monitor Scan for vendor: "${vendor}" (Mocking Bright Data SERP response)...`, 'info');
    
    // Reset visualizer and buttons
    resetVisualizer();
    setNodeState('threat', 'active');
    btnTrigger.disabled = true;

    try {
      const res = await fetch('/api/cron/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulateVendor: vendor, simulateSeverity: severity })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || 'Trigger failed');
      }

      currentRecordId = data.recordId;
      log(`State machine pipeline initiated. DB record: ${currentRecordId}`, 'success');
      startPolling(currentRecordId);

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
