// To jest REFERENCJA - całą zmianę dodam edytem do istniejącego pliku
// Dodawane elementy HTML w panelu admin:

// 1. Nowy tab "API Emulation":
<button class="tab" onclick="switchTab('emulation')">🎭 API Emulation</button>

// 2. W sekcji formularzy - nowy select dla custom modeli:
<div class="form-group">
    <label>Docelowy Model (zaktualizuj dynamicznie):</label>
    <select id="new-target-model" required>
        <option value="">-- Wybierz z listy --</option>
        <optgroup label="OpenRouter">
            <option value="opencode/minimax-m2.1-free:free">MiniMax M2.1</option>
            <option value="github-copilot/claude-haiku-4.5:free">Claude Haiku 4.5</option>
        </optgroup>
    </select>
    <div id="custom-models-group"></div>
</div>

// 3. Nowy JavaScript do dynamicznego ładowania:
async function loadAvailableApis() {
    try {
        const response = await fetch('/v1/emulate');
        const data = response.json();
        populateApiEmulationTab(data);
    } catch (error) {
        console.error('Error loading available APIs:', error);
    }
}

async function switchEmulationApi(apiId) {
    try {
        const response = await fetch('/v1/emulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api: apiId })
        });
        const result = await response.json();
        if (response.ok) {
            alert(`Switched to ${apiId} API emulation`);
            loadAvailableApis();
        }
    } catch (error) {
        alert('Error switching API: ' + error.message);
    }
}
