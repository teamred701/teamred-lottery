/**
 * 抽選アプリケーション - メインスクリプト
 * プレミアムな抽選体験を提供
 */

// グローバル状態管理
let appState = {
    participants: new Map(), // name -> weight のマップ
    winners: new Set(), // 当選歴のある参加者名
    winnerHistory: [], // 当選履歴詳細 [{name, prize, eventName, timestamp}]
    excludedParticipants: new Set(), // 手動で除外された参加者名
    currentTab: 'single',
    selectedTime: 5,
    allowDuplicateWinners: false, // 重複当選許可フラグ（false = OFF）
    isLotteryRunning: false,
    lastResults: [],
    lastEventMonthSelection: '',
    // スプレッドシート連携（自動設定）
    spreadsheetEnabled: true,
    spreadsheetUrl: '',
    // Discord通知
    discordEnabled: true,
    discordWebhookUrl: '',
    // Notion記録（自動設定）
    notionToken: '',
    notionDatabaseId: '',
    // リハーサルモード
    rehearsalMode: false
};

// 現在の抽選ラウンド情報（再抽選用）
let currentRound = {
    eventName: '',
    prizeName: '',
    declinedNames: new Set()
};

// DOM要素の参照
const elements = {
    // タブ関連
    tabButtons: document.querySelectorAll('.tab-button'),
    tabContents: document.querySelectorAll('.tab-content'),
    
    // 参加者追加（単体）
    participantName: document.getElementById('participant-name'),
    participantWeight: document.getElementById('participant-weight'),
    addParticipantBtn: document.getElementById('add-participant'),
    
    // 参加者追加（一括）
    bulkInput: document.getElementById('bulk-input'),
    addBulkBtn: document.getElementById('add-bulk'),
    
    // 参加者リスト
    participantsTable: document.getElementById('participants-table'),
    participantsCount: document.getElementById('participants-count'),
    totalWeight: document.getElementById('total-weight'),
    
    // 抽選設定
    eventName: document.getElementById('event-name'),
    eventMonth: document.getElementById('event-month'),
    eventNameSuffix: document.querySelector('.event-name-suffix'),
    prizeName: document.getElementById('prize-name'),
    winnerCount: document.getElementById('winner-count'),
    winnerCountSuffix: document.getElementById('winner-count-suffix'),
    excludedParticipantsTextarea: document.getElementById('excluded-participants'),
    duplicateSettingSelect: document.getElementById('duplicate-setting'),
    startLotteryBtn: document.getElementById('start-lottery'),
    
    // 抽選アニメーション
    lotteryAnimation: document.getElementById('lottery-animation'),
    currentName: document.getElementById('current-name'),
    
    // 結果表示
    resultsCard: document.getElementById('results-card'),
    lotteryResults: document.getElementById('lottery-results'),
    winnersList: document.getElementById('winners-list'),
    copyWinnersDetailedBtn: document.getElementById('copy-winners-detailed'),
    
    // 時刻表示
    currentTimeDisplay: document.getElementById('current-time'),
    
    // その他
    resetWinnersBtn: document.getElementById('reset-winners'),
    resetAllBtn: document.getElementById('reset-all'),
    
    // エラーメッセージ
    participantsError: document.getElementById('participants-error'),
    lotteryError: document.getElementById('lottery-error'),
    nameError: document.getElementById('name-error'),
    weightError: document.getElementById('weight-error'),
    eventError: document.getElementById('event-error'),
    countError: document.getElementById('count-error'),
    // リハーサルモード
    rehearsalEnabledCheckbox: document.getElementById('rehearsal-enabled'),
    rehearsalStatus: document.getElementById('rehearsal-status'),
    rehearsalBanner: document.getElementById('rehearsal-banner')
};

/**
 * イベント選択に関する情報を取得
 * @returns {{baseName: string, month: string, eventName: string, isStatic: boolean}}
 */
function getEventSelectionInfo() {
    if (!elements.eventName) {
        return { baseName: '', month: '', eventName: '', isStatic: false };
    }

    const selectedIndex = elements.eventName.selectedIndex;
    const option = selectedIndex >= 0 ? elements.eventName.options[selectedIndex] : null;
    const monthValue = elements.eventMonth ? elements.eventMonth.value : '';

    if (!option || !option.value) {
        return { baseName: '', month: monthValue, eventName: '', isStatic: false };
    }

    const baseName = option.value.trim();
    const isStatic = option.dataset.staticEvent === 'true';

    if (isStatic) {
        return { baseName, month: '', eventName: baseName, isStatic: true };
    }

    if (!monthValue) {
        return { baseName, month: '', eventName: '', isStatic: false };
    }

    return { baseName, month: monthValue, eventName: `${baseName} ${monthValue}月抽選会`, isStatic: false };
}

/**
 * イベント名入力UIの状態を更新
 */
function updateEventNameControls() {
    if (!elements.eventMonth) return;

    const info = getEventSelectionInfo();

    if (info.isStatic && !elements.eventMonth.disabled) {
        appState.lastEventMonthSelection = elements.eventMonth.value || appState.lastEventMonthSelection;
    }

    if (info.isStatic) {
        elements.eventMonth.value = '';
    }

    const shouldDisableMonth = appState.isLotteryRunning || info.isStatic;
    elements.eventMonth.disabled = shouldDisableMonth;

    if (!shouldDisableMonth && !elements.eventMonth.value && appState.lastEventMonthSelection) {
        elements.eventMonth.value = appState.lastEventMonthSelection;
    }

    if (elements.eventNameSuffix) {
        if (info.isStatic) {
            elements.eventNameSuffix.classList.add('is-hidden');
        } else {
            elements.eventNameSuffix.classList.remove('is-hidden');
        }
    }
}

/**
 * 一括入力テキストをパースして参加者リストを取得
 * @param {string} text - 入力テキスト
 * @returns {Array} [{name: string, weight: number}] の配列
 */
function parseBulkInput(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const participants = [];
    
    for (const line of lines) {
        // カンマまたはスペースで分割
        const parts = line.split(/[,\s]+/).filter(part => part);
        if (parts.length === 0) continue;
        
        const name = parts[0];
        let weight = 1;
        
        // 2番目の部分が数値かチェック
        if (parts.length > 1) {
            const parsedWeight = parseInt(parts[1], 10);
            if (parsedWeight > 0) {
                weight = parsedWeight;
            }
        }
        
        if (name) {
            participants.push({ name, weight });
        }
    }
    
    return participants;
}

/**
 * 参加者を追加または既存の口数と合算
 * @param {string} name - 参加者名
 * @param {number} weight - 口数
 */
function addOrMergeParticipant(name, weight) {
    if (appState.participants.has(name)) {
        const currentWeight = appState.participants.get(name);
        appState.participants.set(name, currentWeight + weight);
    } else {
        appState.participants.set(name, weight);
    }
}

/**
 * 参加者リストを画面に描画
 */
function renderParticipantsList() {
    const tbody = elements.participantsTable;
    tbody.innerHTML = '';
    
    if (appState.participants.size === 0) {
        tbody.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255, 255, 255, 0.6);">参加者がいません</div>';
        return;
    }
    
    // 名前でソート
    const sortedParticipants = Array.from(appState.participants.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedParticipants.forEach(([name, weight]) => {
        const row = document.createElement('div');
        row.className = 'participant-row';
        row.innerHTML = `
            <div class="participant-name">${escapeHtml(name)}</div>
            <div class="participant-weight">${weight}口</div>
            <div class="participant-actions">
                <button class="btn btn-small btn-secondary" onclick="editParticipant('${escapeHtml(name)}')" aria-label="${name}を編集">編集</button>
                <button class="btn btn-small btn-danger" onclick="removeParticipant('${escapeHtml(name)}')" aria-label="${name}を削除">削除</button>
            </div>
        `;
        tbody.appendChild(row);
    });
}

/**
 * 参加者サマリーを更新
 */
function updateParticipantsSummary() {
    const count = appState.participants.size;
    const totalWeight = Array.from(appState.participants.values()).reduce((sum, weight) => sum + weight, 0);
    
    elements.participantsCount.textContent = `参加者数: ${count}名`;
    elements.totalWeight.textContent = `総口数: ${totalWeight}口`;
    
    updateAvailableParticipantsDisplay();
    updateLotteryButtonState();
}

/**
 * 除外対象者リストを更新
 */
function updateExcludedParticipants() {
    const excludedText = elements.excludedParticipantsTextarea.value.trim();
    appState.excludedParticipants.clear();
    
    if (excludedText) {
        const excludedNames = excludedText.split('\n')
            .map(line => line.trim())
            .filter(line => line);
        
        excludedNames.forEach(name => {
            appState.excludedParticipants.add(name);
        });
    }
    
    updateAvailableParticipantsDisplay();
    updateLotteryButtonState();
    saveToStorage();
}

/**
 * 利用可能な参加者数表示を更新
 */
function updateAvailableParticipantsDisplay() {
    const totalCount = appState.participants.size;
    let availableCount = totalCount;
    
    // 除外対象者を減算
    const excludedCount = Array.from(appState.participants.keys())
        .filter(name => appState.excludedParticipants.has(name)).length;
    availableCount -= excludedCount;
    
    // 重複当選が許可されていない場合、当選歴のある参加者を減算
    if (!appState.allowDuplicateWinners) {
        const winnersInParticipants = Array.from(appState.participants.keys())
            .filter(name => appState.winners.has(name) && !appState.excludedParticipants.has(name)).length;
        availableCount -= winnersInParticipants;
    }
    
    elements.winnerCountSuffix.textContent = `/ ${availableCount}名中`;
    
    // 詳細情報を追加
    if (excludedCount > 0 || appState.winners.size > 0) {
        elements.winnerCountSuffix.textContent += ` (全${totalCount}名)`;
    }
    
    // 除外状態表示を更新
    updateExclusionStatusDisplay();
}

/**
 * 除外状態表示を更新
 */
function updateExclusionStatusDisplay() {
    // 当選歴による除外者表示（重複許可が無効の場合のみ）
    const excludedByHistoryElement = document.getElementById('excluded-by-history-count');
    const excludedByHistoryNamesElement = document.getElementById('excluded-by-history-names');
    
    if (excludedByHistoryElement && excludedByHistoryNamesElement) {
        if (!appState.allowDuplicateWinners) {
            const excludedByHistory = Array.from(appState.participants.keys())
                .filter(name => appState.winners.has(name));
            
            excludedByHistoryElement.textContent = `${excludedByHistory.length}名`;
            
            if (excludedByHistory.length > 0) {
                // 最大4名まで表示、それ以上は"他○名"で表示
                let displayNames = excludedByHistory.slice(0, 4);
                let namesText = displayNames.join(', ');
                
                if (excludedByHistory.length > 4) {
                    namesText += ` 他${excludedByHistory.length - 4}名`;
                }
                
                excludedByHistoryNamesElement.textContent = namesText;
            } else {
                excludedByHistoryNamesElement.textContent = '';
            }
        } else {
            // 重複許可の場合は当選歴による除外はなし
            excludedByHistoryElement.textContent = '0名';
            excludedByHistoryNamesElement.textContent = '';
        }
    }
    
    // 手動除外者表示
    const manualExcludedCountElement = document.getElementById('manual-excluded-count');
    const manualExcludedNamesElement = document.getElementById('manual-excluded-names');
    
    if (manualExcludedCountElement && manualExcludedNamesElement) {
        const manualExcluded = Array.from(appState.participants.keys())
            .filter(name => appState.excludedParticipants.has(name));
        
        manualExcludedCountElement.textContent = `${manualExcluded.length}名`;
        
        if (manualExcluded.length > 0) {
            // 最大4名まで表示、それ以上は“他○名”で表示
            let displayNames = manualExcluded.slice(0, 4);
            let namesText = displayNames.join(', ');
            
            if (manualExcluded.length > 4) {
                namesText += ` 他${manualExcluded.length - 4}名`;
            }
            
            manualExcludedNamesElement.textContent = namesText;
        } else {
            manualExcludedNamesElement.textContent = '';
        }
    }
}

/**
 * HTMLエスケープ
 * @param {string} text - エスケープするテキスト
 * @returns {string} エスケープ済みテキスト
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 参加者を編集
 * @param {string} name - 参加者名
 */
function editParticipant(name) {
    const currentWeight = appState.participants.get(name);
    const newWeight = prompt(`${name}さんの口数を編集してください:`, currentWeight);
    
    if (newWeight === null) return;
    
    const parsedWeight = parseInt(newWeight, 10);
    if (isNaN(parsedWeight) || parsedWeight < 1) {
        alert('口数は1以上の整数で入力してください。');
        return;
    }
    
    appState.participants.set(name, parsedWeight);
    renderParticipantsList();
    updateParticipantsSummary();
    saveToStorage();
}

/**
 * 参加者を削除
 * @param {string} name - 参加者名
 */
function removeParticipant(name) {
    if (confirm(`${name}さんを削除しますか？`)) {
        appState.participants.delete(name);
        renderParticipantsList();
        updateParticipantsSummary();
        saveToStorage();
    }
}

/**
 * ローカルストレージにデータを保存
 */
function saveToStorage() {
    const data = {
        participants: Array.from(appState.participants.entries()),
        winners: Array.from(appState.winners),
        winnerHistory: appState.winnerHistory,
        excludedParticipants: Array.from(appState.excludedParticipants),
        excludedParticipantsText: elements.excludedParticipantsTextarea.value,
        eventName: elements.eventName.value,
        eventMonth: elements.eventMonth.value,
        prizeName: elements.prizeName.value,
        winnerCount: parseInt(elements.winnerCount.value, 10) || 1,
        selectedTime: appState.selectedTime,
        allowDuplicateWinners: appState.allowDuplicateWinners,
        spreadsheetEnabled: appState.spreadsheetEnabled,
        spreadsheetUrl: appState.spreadsheetUrl,
        discordEnabled: appState.discordEnabled,
        discordWebhookUrl: appState.discordWebhookUrl,
        rehearsalMode: appState.rehearsalMode
    };
    
    try {
        localStorage.setItem('lottery-app-data', JSON.stringify(data));
    } catch (e) {
        console.warn('ローカルストレージへの保存に失敗しました:', e);
    }
}

/**
 * ローカルストレージからデータを読み込み
 */
function loadFromStorage() {
    try {
        const saved = localStorage.getItem('lottery-app-data');
        if (!saved) return;
        
        const data = JSON.parse(saved);
        
        // 参加者リストを復元
        appState.participants.clear();
        if (data.participants) {
            data.participants.forEach(([name, weight]) => {
                appState.participants.set(name, weight);
            });
        }
        
        // 当選歴を復元
        appState.winners.clear();
        if (data.winners) {
            data.winners.forEach(name => {
                appState.winners.add(name);
            });
        }
        
        // 当選履歴詳細を復元
        appState.winnerHistory = [];
        if (data.winnerHistory) {
            appState.winnerHistory = data.winnerHistory;
        }
        
        // 除外対象者を復元
        appState.excludedParticipants.clear();
        if (data.excludedParticipants) {
            data.excludedParticipants.forEach(name => {
                appState.excludedParticipants.add(name);
            });
        }
        if (data.excludedParticipantsText) {
            elements.excludedParticipantsTextarea.value = data.excludedParticipantsText;
        }
        
        // フォーム値を復元
        if (data.eventName) elements.eventName.value = data.eventName;
        if (data.eventMonth) elements.eventMonth.value = data.eventMonth;
        if (data.prizeName) elements.prizeName.value = data.prizeName;
        if (data.winnerCount) elements.winnerCount.value = data.winnerCount;
        if (data.selectedTime) {
            appState.selectedTime = data.selectedTime;
            if (elements.lotteryTimeSelect) {
                elements.lotteryTimeSelect.value = data.selectedTime;
            }
        }

        appState.lastEventMonthSelection = elements.eventMonth.value || '';
        updateEventNameControls();
        
        
        // 重複当選設定を復元
        if (typeof data.allowDuplicateWinners === 'boolean') {
            appState.allowDuplicateWinners = data.allowDuplicateWinners;
            elements.duplicateSettingSelect.value = data.allowDuplicateWinners ? 'on' : 'off';
        }

        // スプレッドシート連携設定を復元
        if (typeof data.spreadsheetEnabled === 'boolean') {
            appState.spreadsheetEnabled = data.spreadsheetEnabled;
        }
        if (data.spreadsheetUrl) {
            appState.spreadsheetUrl = data.spreadsheetUrl;
        }

        // Discord通知設定を復元
        if (typeof data.discordEnabled === 'boolean') {
            appState.discordEnabled = data.discordEnabled;
        }
        if (data.discordWebhookUrl) {
            appState.discordWebhookUrl = data.discordWebhookUrl;
        }

        // リハーサルモードを復元
        if (typeof data.rehearsalMode === 'boolean') {
            appState.rehearsalMode = data.rehearsalMode;
            if (elements.rehearsalEnabledCheckbox) {
                elements.rehearsalEnabledCheckbox.checked = data.rehearsalMode;
            }
            if (elements.rehearsalStatus) {
                elements.rehearsalStatus.textContent = data.rehearsalMode ? 'ON' : 'OFF';
            }
            if (elements.rehearsalBanner) {
                elements.rehearsalBanner.style.display = data.rehearsalMode ? 'block' : 'none';
            }
        }

        // 除外対象者リストを更新
        updateExcludedParticipants();
        
        renderParticipantsList();
        updateParticipantsSummary();
        
    } catch (e) {
        console.warn('ローカルストレージからの読み込みに失敗しました:', e);
    }
}

/**
 * 重み付きランダム抽選を実行
 * @param {Array} pool - [{name: string, weight: number}] の配列
 * @param {number} count - 当選者数
 * @returns {Array} 当選者名の配列
 */
function performLottery(pool, count) {
    if (pool.length === 0 || count <= 0) return [];
    
    // 除外対象者をフィルタリング
    let availablePool = pool.filter(p => !appState.excludedParticipants.has(p.name));
    
    // 重複当選が許可されていない場合、当選歴のある参加者を除外
    if (!appState.allowDuplicateWinners) {
        availablePool = availablePool.filter(p => !appState.winners.has(p.name));
    }
    
    if (availablePool.length === 0) {
        return [];
    }
    
    const winners = [];
    const drawPool = [...availablePool];
    
    for (let i = 0; i < count && drawPool.length > 0; i++) {
        // 総重みを計算
        const totalWeight = drawPool.reduce((sum, p) => sum + p.weight, 0);
        
        // 暗号学的に安全な乱数を生成
        let random;
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            random = array[0] / (0xFFFFFFFF + 1);
        } else {
            random = Math.random();
        }
        
        // 重み付き選択
        let currentWeight = 0;
        const threshold = random * totalWeight;
        
        for (let j = 0; j < drawPool.length; j++) {
            currentWeight += drawPool[j].weight;
            if (currentWeight >= threshold) {
                const winner = drawPool[j].name;
                winners.push(winner);
                
                // 重複当選が許可されていない場合のみ、当選歴に追加（将来の抽選から除外）
                // リハーサルモード中は当選歴を更新しない
                if (!appState.allowDuplicateWinners && !appState.rehearsalMode) {
                    appState.winners.add(winner);
                }
                
                // この抽選で重複しないよう、抽選プールから除外
                drawPool.splice(j, 1);
                break;
            }
        }
    }
    
    return winners;
}

/**
 * 抽選を開始
 */
async function startLottery() {
    const eventInfo = getEventSelectionInfo();
    const eventName = eventInfo.eventName;
    const prizeName = elements.prizeName.value || '抽選';
    const winnerCount = parseInt(elements.winnerCount.value, 10);

    // バリデーション
    if (!eventName) {
        showError('lottery-error', 'イベント名を入力してください。');
        return;
    }
    
    if (appState.participants.size === 0) {
        showError('lottery-error', '参加者がいません。');
        return;
    }
    
    // 利用可能な参加者数をチェック
    let availableParticipants = Array.from(appState.participants.keys())
        .filter(name => {
            if (appState.excludedParticipants.has(name)) return false;
            if (!appState.allowDuplicateWinners && appState.winners.has(name)) return false;
            return true;
        }).length;
    
    if (availableParticipants === 0) {
        let message = '利用可能な参加者がいません。';
        if (appState.excludedParticipants.size > 0 && appState.winners.size > 0 && !appState.allowDuplicateWinners) {
            message += '（除外対象・当選歴あり）';
        } else if (appState.excludedParticipants.size > 0) {
            message += '（除外対象）';
        } else if (appState.winners.size > 0 && !appState.allowDuplicateWinners) {
            message += '（全員が当選歴あり）';
        }
        showError('lottery-error', message);
        return;
    }
    
    if (winnerCount > availableParticipants) {
        showError('lottery-error', `当選者数が利用可能な参加者数（${availableParticipants}名）を超えています。`);
        return;
    }
    
    if (winnerCount <= 0) {
        showError('lottery-error', '当選者数は1以上で入力してください。');
        return;
    }
    
    clearError('lottery-error');
    
    // 抽選状態に設定
    appState.isLotteryRunning = true;
    updateUILockState();
    
    // 結果を隠す
    elements.lotteryResults.classList.remove('show');
    
    // アニメーション開始
    elements.lotteryAnimation.classList.add('active');

    // 参加者プールを準備
    const pool = Array.from(appState.participants.entries()).map(([name, weight]) => ({
        name,
        weight
    }));

    // スロットアニメーション
    const animationDuration = appState.selectedTime * 1000;
    const animationInterval = 100;
    const iterations = Math.floor(animationDuration / animationInterval);

    for (let i = 0; i < iterations; i++) {
        const randomIndex = Math.floor(Math.random() * pool.length);
        elements.currentName.textContent = pool[randomIndex].name;
        await new Promise(resolve => setTimeout(resolve, animationInterval));
    }

    // 最終抽選実行
    const winners = performLottery(pool, winnerCount);
    appState.lastResults = winners.map(name => ({ prize: prizeName, name }));

    // アニメーション終了
    elements.lotteryAnimation.classList.remove('active');

    // 結果表示
    displayResults(eventName, prizeName, winners);
    
    // 抽選状態を解除
    appState.isLotteryRunning = false;
    updateUILockState();
    
    saveToStorage();
}

/**
 * 抽選結果を表示
 * @param {string} eventName - イベント名
 * @param {string} prizeName - 賞名
 * @param {Array} winners - 当選者名の配列
 */
function displayResults(eventName, prizeName, winners) {
    // 現在のラウンド情報を保存（再抽選用）
    currentRound.eventName = eventName;
    currentRound.prizeName = prizeName;
    currentRound.declinedNames = new Set();

    const resultsTitle = elements.lotteryResults.querySelector('.results-title');
    // リハーサルモード中はタイトルに目印を付ける
    if (appState.rehearsalMode) {
        resultsTitle.textContent = `【リハーサル】${prizeName} 当選者発表`;
        resultsTitle.classList.add('rehearsal');
    } else {
        resultsTitle.textContent = `${prizeName} 当選者発表`;
        resultsTitle.classList.remove('rehearsal');
    }

    elements.winnersList.innerHTML = '';

    // 当選履歴に記録（リハーサルモード中はスキップ）
    const timestamp = new Date();
    const newWinnerRecords = [];
    if (!appState.rehearsalMode) {
        winners.forEach(name => {
            const record = {
                name: name,
                prize: prizeName,
                eventName: eventName,
                timestamp: timestamp.toISOString(),
                displayTime: formatDateTime(timestamp)
            };
            appState.winnerHistory.push(record);
            newWinnerRecords.push(record);
        });
    }

    // スプレッドシートに送信（リハーサルモード中はスキップ）
    if (!appState.rehearsalMode && appState.spreadsheetEnabled && appState.spreadsheetUrl) {
        sendToSpreadsheet(newWinnerRecords);
    }

    // Discordに通知（リハーサルモード中はスキップ）
    if (!appState.rehearsalMode && appState.discordEnabled && appState.discordWebhookUrl) {
        sendToDiscord(eventName, prizeName, winners);
    }

    // Notionに記録（リハーサルモード中はスキップ）
    if (!appState.rehearsalMode && appState.notionToken && appState.notionDatabaseId) {
        const totalParticipants = appState.participants.size;
        const totalWeight = Array.from(appState.participants.values()).reduce((sum, w) => sum + w, 0);

        winners.forEach(async (name) => {
            const winnerWeight = appState.participants.get(name) || 1;
            try {
                await saveWinnerToNotion(eventName, prizeName, name, winnerWeight, totalParticipants, totalWeight);
            } catch (error) {
                console.error('Notion記録エラー:', error);
                // エラーが発生しても抽選処理は継続
            }
        });
    }

    // 当選者を順番にアニメーション表示
    winners.forEach((name, index) => {
        setTimeout(() => {
            elements.winnersList.appendChild(createWinnerItem(name, index * 0.3));
        }, index * 300);
    });
    
    // 当選履歴を表示
    updateWinnerHistoryDisplay();
    
    // 結果カードを表示
    elements.resultsCard.classList.add('show');
    elements.lotteryResults.classList.add('show');
    
    // 結果カードにスクロール
    setTimeout(() => {
        elements.resultsCard.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }, 500);
}

/**
 * 当選者アイテムのDOM要素を生成
 * @param {string} name - 当選者名
 * @param {number} animDelay - アニメーション遅延秒数
 * @returns {HTMLElement}
 */
function createWinnerItem(name, animDelay) {
    const winnerItem = document.createElement('div');
    winnerItem.className = 'winner-item';
    winnerItem.dataset.name = name;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'winner-name';
    nameSpan.textContent = name;

    const redrawBtn = document.createElement('button');
    redrawBtn.className = 'btn-redraw';
    redrawBtn.textContent = '辞退・再抽選';
    redrawBtn.addEventListener('click', () => redrawWinner(winnerItem));

    winnerItem.appendChild(nameSpan);
    winnerItem.appendChild(redrawBtn);
    winnerItem.style.animationDelay = `${animDelay}s`;
    return winnerItem;
}

/**
 * 特定の当選者を辞退させ再抽選する
 * @param {HTMLElement} winnerItem - 対象の当選者アイテム要素
 */
async function redrawWinner(winnerItem) {
    const declinedName = winnerItem.dataset.name;
    if (!confirm(`「${declinedName}」を辞退にして再抽選しますか？`)) return;

    // 辞退者を記録（このラウンドで再度選ばれないように）
    currentRound.declinedNames.add(declinedName);

    // 重複当選OFFの場合、当選歴から除外
    appState.winners.delete(declinedName);

    // winnerHistory から最新の一致エントリを削除
    for (let i = appState.winnerHistory.length - 1; i >= 0; i--) {
        if (appState.winnerHistory[i].name === declinedName &&
            appState.winnerHistory[i].prize === currentRound.prizeName) {
            appState.winnerHistory.splice(i, 1);
            break;
        }
    }

    // lastResults からも削除
    appState.lastResults = appState.lastResults.filter(r => r.name !== declinedName);

    // UIをローディング状態に
    const nameSpan = winnerItem.querySelector('.winner-name');
    const redrawBtn = winnerItem.querySelector('.btn-redraw');
    winnerItem.classList.add('redrawing');
    nameSpan.textContent = '再抽選中...';
    redrawBtn.disabled = true;

    await new Promise(resolve => setTimeout(resolve, 800));

    // 現在表示中の当選者（辞退者以外）を取得して除外リストに加える
    const currentWinnerNames = Array.from(
        document.querySelectorAll('.winner-item[data-name]')
    ).map(el => el.dataset.name).filter(n => n !== declinedName);

    // 再抽選プールを構築
    const pool = Array.from(appState.participants.entries())
        .filter(([name]) => {
            if (appState.excludedParticipants.has(name)) return false;
            if (currentRound.declinedNames.has(name)) return false;
            if (currentWinnerNames.includes(name)) return false;
            if (!appState.allowDuplicateWinners && appState.winners.has(name)) return false;
            return true;
        })
        .map(([name, weight]) => ({ name, weight }));

    if (pool.length === 0) {
        nameSpan.textContent = '該当者なし';
        redrawBtn.disabled = true;
        winnerItem.classList.remove('redrawing');
        winnerItem.classList.add('no-winner');
        updateWinnerHistoryDisplay();
        saveToStorage();
        return;
    }

    // 1名抽選
    const [newWinner] = performLottery(pool, 1);

    // アイテムを新当選者に更新
    winnerItem.dataset.name = newWinner;
    winnerItem.classList.remove('redrawing');
    nameSpan.textContent = newWinner;
    redrawBtn.disabled = false;
    redrawBtn.onclick = null;
    redrawBtn.addEventListener('click', () => redrawWinner(winnerItem));

    // lastResults に追加
    appState.lastResults.push({ prize: currentRound.prizeName, name: newWinner });

    // winnerHistory に記録（リハーサルモード中はスキップ）
    const timestamp = new Date();
    if (!appState.rehearsalMode) {
        const record = {
            name: newWinner,
            prize: currentRound.prizeName,
            eventName: currentRound.eventName,
            timestamp: timestamp.toISOString(),
            displayTime: formatDateTime(timestamp)
        };
        appState.winnerHistory.push(record);
        updateWinnerHistoryDisplay();
    }

    // Discord通知（リハーサルモード中はスキップ）
    if (!appState.rehearsalMode && appState.discordEnabled && appState.discordWebhookUrl) {
        sendToDiscord(currentRound.eventName, currentRound.prizeName, [newWinner]);
    }

    // Notion記録（リハーサルモード中はスキップ）
    if (!appState.rehearsalMode && appState.notionToken && appState.notionDatabaseId) {
        const winnerWeight = appState.participants.get(newWinner) || 1;
        const totalParticipants = appState.participants.size;
        const totalWeight = Array.from(appState.participants.values()).reduce((sum, w) => sum + w, 0);
        saveWinnerToNotion(currentRound.eventName, currentRound.prizeName, newWinner, winnerWeight, totalParticipants, totalWeight)
            .catch(err => console.error('Notion記録エラー:', err));
    }

    saveToStorage();
}

/**
 * 最後の抽選を取り消す
 */
function cancelLastLottery() {
    if (appState.lastResults.length === 0) return;

    const names = appState.lastResults.map(r => r.name).join('、');
    const confirmed = confirm(
        `この抽選を取り消しますか？\n\n当選者：${names}\n\n※ Discord・Notionへの通知は取り消せません`
    );
    if (!confirmed) return;

    // 当選歴から削除（重複当選OFFのとき次回また対象になる）
    appState.lastResults.forEach(({ name }) => {
        appState.winners.delete(name);
    });

    // winnerHistory から削除（lastResults に含まれる名前・賞名が一致するもの）
    const cancelledNames = new Set(appState.lastResults.map(r => r.name));
    const cancelledPrize = appState.lastResults[0]?.prize;
    for (let i = appState.winnerHistory.length - 1; i >= 0; i--) {
        if (cancelledNames.has(appState.winnerHistory[i].name) &&
            appState.winnerHistory[i].prize === cancelledPrize) {
            appState.winnerHistory.splice(i, 1);
        }
    }

    // lastResults をクリア
    appState.lastResults = [];

    // 結果カードを非表示
    elements.resultsCard.classList.remove('show');
    elements.lotteryResults.classList.remove('show');

    // 履歴表示・ボタン状態を更新
    updateWinnerHistoryDisplay();
    updateAvailableParticipantsDisplay();
    updateLotteryButtonState();
    saveToStorage();
}



/**
 * 賞名の優先度を取得する関数
 * @param {string} prize - 賞名
 * @returns {number} 優先度（小さい数字ほど上位）
 */
function getPrizePriority(prize) {
    const priorities = {
        '1等': 1,
        '2等': 2,
        '3等': 3,
        '4等': 4,
        '5等': 5,
        '6等': 6,
        '7等': 7,
        '8等': 8,
        '9等': 9,
        'リアタイ賞': 10,
        'CNP': 11,
        'CNPRED': 12,
        'カケラNFT': 13,
        'KAKERANFT': 13,
        'Premium特典枠': 14,
        'モバイル枠': 15,
        'CNP REDホルダー枠': 16,
        'CNP REDコンプリート枠': 17,
        '応援ギフト枠': 18,
        '抽選': 19,
        'その他': 20
    };
    
    return priorities[prize] || 99; // 未定義の賞は最下位
}

/**
 * 当選者の詳細情報をクリップボードにコピー（当選履歴から全ての当選者を取得）
 */
async function copyWinnersDetailed() {
    if (appState.winnerHistory.length === 0) {
        alert('コピーする当選履歴がありません。');
        return;
    }
    
    // 当選履歴をイベント別にグループ化
    const eventGroups = new Map();
    
    appState.winnerHistory.forEach(record => {
        const key = `${record.eventName}_${record.prize}`;
        if (!eventGroups.has(key)) {
            eventGroups.set(key, {
                eventName: record.eventName,
                prize: record.prize,
                displayTime: record.displayTime,
                timestamp: record.timestamp,
                winners: []
            });
        }
        eventGroups.get(key).winners.push(record.name);
    });
    
    // グループを時系列（新しい順）、同じ時間内では賞の優先度順でソート
    const sortedGroups = Array.from(eventGroups.values()).sort((a, b) => {
        // まず時系列でソート（新しい順）
        const timeComparison = new Date(b.timestamp) - new Date(a.timestamp);
        if (timeComparison !== 0) {
            return timeComparison;
        }
        
        // 同じ時間の場合は賞の優先度でソート（1等が上）
        return getPrizePriority(a.prize) - getPrizePriority(b.prize);
    });
    
    // 詳細情報を整形
    let detailedText = '';
    
    sortedGroups.forEach((group, index) => {
        if (index > 0) detailedText += '\n\n';
        
        detailedText += `【${group.prize} 当選者発表】\n`;
        detailedText += `イベント: ${group.eventName}\n`;
        detailedText += `抽選日時: ${group.displayTime}\n`;
        detailedText += `\n当選者:\n`;
        
        group.winners.forEach((name, winnerIndex) => {
            detailedText += `${winnerIndex + 1}. ${name}\n`;
        });
    });
    
    await performCopy(detailedText, elements.copyWinnersDetailedBtn, 'コピー完了！');
}

/**
 * クリップボードへのコピーを実行する共通関数
 * @param {string} text - コピーするテキスト
 * @param {Element} buttonElement - フィードバックを表示するボタン要素
 * @param {string} successMessage - 成功時のメッセージ
 */
async function performCopy(text, buttonElement, successMessage) {
    try {
        // Clipboard APIを使用してコピー
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            
            // コピー成功のフィードバック
            const originalText = buttonElement.innerHTML;
            buttonElement.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                </svg>
                ${successMessage}
            `;
            
            setTimeout(() => {
                buttonElement.innerHTML = originalText;
            }, 2000);
        } else {
            // フォールバック：テキストエリアを使用
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            alert('クリップボードにコピーしました。');
        }
    } catch (err) {
        console.error('コピーに失敗しました:', err);
        alert('クリップボードへのコピーに失敗しました。');
    }
}

/**
 * CSVをダウンロード（当選履歴全体）
 * @param {Array} results - 使用されない（当選履歴を使用）
 */
function downloadCSV(results) {
    if (appState.winnerHistory.length === 0) {
        alert('ダウンロードする当選履歴がありません。');
        return;
    }
    
    // CSV形式に変換（UTF-8 BOM付き）
    const csvContent = '\ufeff当選日時,イベント名,賞品名,当選者名\n' + 
        appState.winnerHistory.map(record => {
            return `"${record.displayTime}","${record.eventName}","${record.prize}","${record.name}"`;
        }).join('\n');
    
    // ダウンロード実行
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `当選履歴_${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        alert('お使いのブラウザではCSVダウンロードがサポートされていません。');
    }
}

/**
 * 参加者リストをCSVでエクスポート
 */
function exportParticipantsCSV() {
    if (appState.participants.size === 0) {
        alert('エクスポートする参加者がいません。');
        return;
    }

    // CSV形式に変換（UTF-8 BOM付き）
    const csvContent = '\ufeff名前,口数\n' +
        Array.from(appState.participants.entries())
            .sort((a, b) => a[0].localeCompare(b[0])) // 名前でソート
            .map(([name, weight]) => {
                return `"${name.replace(/"/g, '""')}",${weight}`;
            }).join('\n');

    // ダウンロード実行
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `参加者リスト_${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        alert('お使いのブラウザではCSVダウンロードがサポートされていません。');
    }
}

/**
 * 参加者リストをCSVからインポート
 * @param {File} file - CSVファイル
 */
async function importParticipantsCSV(file) {
    if (!file) return;

    try {
        const text = await file.text();

        // BOMを削除
        const cleanText = text.replace(/^\ufeff/, '');

        // CSVをパース
        const lines = cleanText.split('\n').map(line => line.trim()).filter(line => line);

        if (lines.length === 0) {
            alert('ファイルが空です。');
            return;
        }

        // ヘッダー行をスキップ（"名前"で始まる場合）
        let startIndex = 0;
        if (lines[0].includes('名前') || lines[0].includes('name')) {
            startIndex = 1;
        }

        const importedParticipants = [];
        const errors = [];

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i];

            // CSVパース（カンマ区切り、ダブルクォート対応）
            // A列:名前、B列:口数（口数は省略可能）
            let name = '';
            let weight = 1;

            // カンマで分割（ダブルクォートを考慮）
            const parts = [];
            let current = '';
            let inQuotes = false;

            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                    current += char;
                } else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            parts.push(current.trim());

            // 名前を取得（ダブルクォートを除去）
            if (parts.length >= 1 && parts[0]) {
                name = parts[0].replace(/^"|"$/g, '').replace(/""/g, '"').trim();
            }

            // 口数を取得（省略時は1）
            if (parts.length >= 2 && parts[1]) {
                const weightStr = parts[1].replace(/^"|"$/g, '').trim();
                if (weightStr) {
                    weight = parseInt(weightStr, 10);
                    if (isNaN(weight) || weight < 1) {
                        errors.push(`${i + 1}行目: 口数が不正（${name}）`);
                        continue;
                    }
                }
            }

            if (name) {
                importedParticipants.push({ name, weight });
            }
        }

        if (importedParticipants.length === 0) {
            alert('有効な参加者データが見つかりませんでした。\n\nCSV形式:\n名前,口数\n佐藤太郎,3\n山田花子,1');
            return;
        }

        // インポートモードの選択
        let importMode = 'add'; // デフォルトは追加モード

        if (appState.participants.size > 0) {
            // 既存の参加者がいる場合は、モードを選択
            const message = `${importedParticipants.length}名の参加者を読み込みます。\n\n現在の参加者リスト: ${appState.participants.size}名\n\n【上書き】を選択すると、既存のリストを削除して新しいリストに置き換えます。\n【追加】を選択すると、既存のリストに追加します（同じ名前がある場合は口数を合算します）。${errors.length > 0 ? `\n\n以下のエラーがあります:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n他${errors.length - 5}件` : ''}` : ''}`;

            const result = confirm(message + '\n\n【OK】= 追加　【キャンセル】= 中止');

            if (!result) {
                return; // キャンセル
            }

            // 追加か上書きかを確認
            const overwrite = confirm('既存のリストを削除して上書きしますか？\n\n【OK】= 上書き　【キャンセル】= 追加');
            importMode = overwrite ? 'overwrite' : 'add';
        } else {
            // 既存の参加者がいない場合は、確認のみ
            const confirmMessage = `${importedParticipants.length}名の参加者をインポートします。${errors.length > 0 ? `\n\n以下のエラーがあります:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n他${errors.length - 5}件` : ''}` : ''}\n\nよろしいですか？`;

            if (!confirm(confirmMessage)) {
                return;
            }
        }

        // インポート実行
        if (importMode === 'overwrite') {
            // 既存の参加者リストをクリア
            appState.participants.clear();
        }

        // インポート（追加モードでは既存の参加者と合算される）
        importedParticipants.forEach(({ name, weight }) => {
            addOrMergeParticipant(name, weight);
        });

        // 画面更新
        renderParticipantsList();
        updateParticipantsSummary();
        saveToStorage();

        if (importMode === 'overwrite') {
            alert(`${importedParticipants.length}名の参加者をインポートしました（上書き）。`);
        } else {
            alert(`${importedParticipants.length}名の参加者を追加しました。\n現在の参加者数: ${appState.participants.size}名`);
        }

    } catch (error) {
        console.error('CSVインポートエラー:', error);
        alert('ファイルの読み込みに失敗しました。\n\nCSV形式で保存されたファイルを選択してください。');
    }
}

/**
 * Excelファイルをダウンロード（.xlsx形式）
 * @param {Array} results - [{prize: string, name: string}] の配列
 */

/**
 * セル参照をエンコード（A1形式）
 * @param {Object} cell - {c: column, r: row}
 * @returns {string} セル参照（例: "A1"）
 */
function encodeCell(cell) {
    let col = '';
    let num = cell.c;
    while (num >= 0) {
        col = String.fromCharCode(65 + (num % 26)) + col;
        num = Math.floor(num / 26) - 1;
        if (num < 0) break;
    }
    return col + (cell.r + 1);
}

/**
 * 範囲をエンコード（A1:C10形式）
 * @param {Object} range - {s: {c, r}, e: {c, r}}
 * @returns {string} 範囲参照
 */
function encodeRange(range) {
    return encodeCell(range.s) + ':' + encodeCell(range.e);
}

/**
 * ワークブックをXLSX形式のバイナリデータに変換
 * @param {Object} workbook - ワークブックオブジェクト
 * @returns {Uint8Array} XLSXバイナリデータ
 */
function writeWorkbook(workbook) {
    // 簡易的なXLSX生成（ZIP形式）
    const zip = new Map();
    
    // [Content_Types].xml
    zip.set('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
    
    // _rels/.rels
    zip.set('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    
    // xl/_rels/workbook.xml.rels
    zip.set('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);
    
    // xl/workbook.xml
    zip.set('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="抽選結果" sheetId="1" r:id="rId1"/>
</sheets>
</workbook>`);
    
    // 共有文字列を収集
    const sharedStrings = new Set();
    const ws = workbook.Sheets['抽選結果'];
    Object.keys(ws).forEach(cell => {
        if (cell.startsWith('!')) return;
        if (ws[cell].t === 's') {
            sharedStrings.add(ws[cell].v);
        }
    });
    
    const sharedStringsArray = Array.from(sharedStrings);
    const sharedStringsMap = new Map(sharedStringsArray.map((str, idx) => [str, idx]));
    
    // xl/sharedStrings.xml
    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStringsArray.length}" uniqueCount="${sharedStringsArray.length}">
${sharedStringsArray.map(str => `<si><t>${escapeXml(str)}</t></si>`).join('\n')}
</sst>`;
    zip.set('xl/sharedStrings.xml', sharedStringsXml);
    
    // xl/worksheets/sheet1.xml
    let worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
    
    if (ws['!merges'] && ws['!merges'].length > 0) {
        worksheetXml += `\n<mergeCells count="${ws['!merges'].length}">`;
        ws['!merges'].forEach(merge => {
            worksheetXml += `\n<mergeCell ref="${encodeRange(merge)}"/>`;
        });
        worksheetXml += '\n</mergeCells>';
    }
    
    worksheetXml += `\n<sheetData>`;
    
    // 行データを生成
    if (ws['!ref']) {
        const range = parseRange(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; R++) {
            let rowData = '';
            let hasData = false;
            
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cellRef = encodeCell({ c: C, r: R });
                if (ws[cellRef]) {
                    const cell = ws[cellRef];
                    if (cell.t === 's') {
                        const strIndex = sharedStringsMap.get(cell.v);
                        rowData += `<c r="${cellRef}" t="s"><v>${strIndex}</v></c>`;
                    } else {
                        rowData += `<c r="${cellRef}"><v>${escapeXml(cell.v)}</v></c>`;
                    }
                    hasData = true;
                }
            }
            
            if (hasData) {
                worksheetXml += `\n<row r="${R + 1}">${rowData}</row>`;
            }
        }
    }
    
    worksheetXml += '\n</sheetData>\n</worksheet>';
    zip.set('xl/worksheets/sheet1.xml', worksheetXml);
    
    // ZIPを生成（簡易実装）
    return createZipBuffer(zip);
}

/**
 * XML特殊文字をエスケープ
 * @param {string} text - エスケープするテキスト
 * @returns {string} エスケープ済みテキスト
 */
function escapeXml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * 範囲文字列をパース
 * @param {string} range - 範囲文字列（例: "A1:C10"）
 * @returns {Object} {s: {c, r}, e: {c, r}}
 */
function parseRange(range) {
    const [start, end] = range.split(':');
    return {
        s: parseCell(start),
        e: parseCell(end)
    };
}

/**
 * セル参照をパース
 * @param {string} cell - セル参照（例: "A1"）
 * @returns {Object} {c: column, r: row}
 */
function parseCell(cell) {
    const match = cell.match(/([A-Z]+)(\d+)/);
    if (!match) return { c: 0, r: 0 };
    
    const [, colStr, rowStr] = match;
    let c = 0;
    for (let i = 0; i < colStr.length; i++) {
        c = c * 26 + (colStr.charCodeAt(i) - 65 + 1);
    }
    c -= 1; // 0ベースに調整
    
    return { c, r: parseInt(rowStr) - 1 };
}

/**
 * 簡易ZIP生成
 * @param {Map} files - ファイルマップ
 * @returns {Uint8Array} ZIPバイナリ
 */
function createZipBuffer(files) {
    // 非常に簡易的なZIP実装
    // 実際のプロダクションでは、JSZipなどのライブラリを使用することを推奨
    
    const encoder = new TextEncoder();
    const zipData = [];
    const centralDir = [];
    let offset = 0;
    
    // ローカルファイルヘッダーとデータを追加
    files.forEach((content, filename) => {
        const filenameBytes = encoder.encode(filename);
        const contentBytes = encoder.encode(content);
        
        // ローカルファイルヘッダー
        const header = new Uint8Array(30 + filenameBytes.length);
        const view = new DataView(header.buffer);
        
        view.setUint32(0, 0x04034b50, true); // ローカルファイルヘッダーシグネチャ
        view.setUint16(4, 20, true); // 最小バージョン
        view.setUint16(6, 0, true); // フラグ
        view.setUint16(8, 0, true); // 圧縮方法（無圧縮）
        view.setUint16(10, 0, true); // ファイル時刻
        view.setUint16(12, 0, true); // ファイル日付
        view.setUint32(14, 0, true); // CRC32（計算省略）
        view.setUint32(18, contentBytes.length, true); // 圧縮サイズ
        view.setUint32(22, contentBytes.length, true); // 非圧縮サイズ
        view.setUint16(26, filenameBytes.length, true); // ファイル名長
        view.setUint16(28, 0, true); // 拡張フィールド長
        
        header.set(filenameBytes, 30);
        
        zipData.push(header);
        zipData.push(contentBytes);
        
        // セントラルディレクトリエントリを記録
        centralDir.push({
            filename,
            filenameBytes,
            contentBytes,
            offset
        });
        
        offset += header.length + contentBytes.length;
    });
    
    const centralDirStart = offset;
    
    // セントラルディレクトリを追加
    centralDir.forEach(({ filenameBytes, contentBytes, offset: fileOffset }) => {
        const header = new Uint8Array(46 + filenameBytes.length);
        const view = new DataView(header.buffer);
        
        view.setUint32(0, 0x02014b50, true); // セントラルディレクトリシグネチャ
        view.setUint16(4, 20, true); // 作成バージョン
        view.setUint16(6, 20, true); // 最小バージョン
        view.setUint16(8, 0, true); // フラグ
        view.setUint16(10, 0, true); // 圧縮方法
        view.setUint16(12, 0, true); // ファイル時刻
        view.setUint16(14, 0, true); // ファイル日付
        view.setUint32(16, 0, true); // CRC32
        view.setUint32(20, contentBytes.length, true); // 圧縮サイズ
        view.setUint32(24, contentBytes.length, true); // 非圧縮サイズ
        view.setUint16(28, filenameBytes.length, true); // ファイル名長
        view.setUint16(30, 0, true); // 拡張フィールド長
        view.setUint16(32, 0, true); // ファイルコメント長
        view.setUint16(34, 0, true); // ディスク番号
        view.setUint16(36, 0, true); // 内部ファイル属性
        view.setUint32(38, 0, true); // 外部ファイル属性
        view.setUint32(42, fileOffset, true); // ローカルヘッダーオフセット
        
        header.set(filenameBytes, 46);
        zipData.push(header);
        
        offset += header.length;
    });
    
    // End of central directory record
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    
    endView.setUint32(0, 0x06054b50, true); // シグネチャ
    endView.setUint16(4, 0, true); // ディスク番号
    endView.setUint16(6, 0, true); // セントラルディレクトリ開始ディスク
    endView.setUint16(8, centralDir.length, true); // このディスクのセントラルディレクトリエントリ数
    endView.setUint16(10, centralDir.length, true); // 総セントラルディレクトリエントリ数
    endView.setUint32(12, offset - centralDirStart, true); // セントラルディレクトリサイズ
    endView.setUint32(16, centralDirStart, true); // セントラルディレクトリオフセット
    endView.setUint16(20, 0, true); // コメント長
    
    zipData.push(endRecord);
    
    // 全データを結合
    const totalLength = zipData.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let pos = 0;
    
    zipData.forEach(arr => {
        result.set(arr, pos);
        pos += arr.length;
    });
    
    return result;
}

/**
 * デバッグ用：分布をテスト（1000回実行）
 * コンソールに結果を出力
 */
function debugDistribution() {
    if (appState.participants.size === 0) {
        console.log('参加者がいません。');
        return;
    }
    
    const pool = Array.from(appState.participants.entries()).map(([name, weight]) => ({
        name,
        weight
    }));
    
    const winnerCount = parseInt(elements.winnerCount.value, 10) || 1;
    const testRuns = 1000;
    const results = new Map();
    
    console.log(`=== 分布テスト開始 (${testRuns}回実行) ===`);
    console.log('参加者:', pool);
    console.log('当選者数:', winnerCount);
    
    for (let i = 0; i < testRuns; i++) {
        const winners = weightedDraw(pool, winnerCount);
        winners.forEach(name => {
            results.set(name, (results.get(name) || 0) + 1);
        });
    }
    
    console.log('\n=== 出現回数 ===');
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    
    Array.from(results.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => {
            const participant = pool.find(p => p.name === name);
            const expectedRate = (participant.weight / totalWeight * winnerCount * testRuns).toFixed(1);
            const actualRate = count;
            console.log(`${name}: ${actualRate}回 (期待値: ${expectedRate}回, 口数: ${participant.weight})`);
        });
    
    console.log('=== テスト終了 ===\n');
}

/**
 * エラーメッセージを表示
 * @param {string} elementId - エラー要素のID
 * @param {string} message - エラーメッセージ
 */
function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add('show');
    }
}

/**
 * エラーメッセージをクリア
 * @param {string} elementId - エラー要素のID
 */
function clearError(elementId) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.classList.remove('show');
    }
}

/**
 * 抽選ボタンの状態を更新
 */
function updateLotteryButtonState() {
    const eventInfo = getEventSelectionInfo();
    const winnerCount = parseInt(elements.winnerCount.value, 10) || 0;
    const hasParticipants = appState.participants.size > 0;
    
    // 利用可能な参加者数を計算
    let availableParticipants = Array.from(appState.participants.keys())
        .filter(name => {
            if (appState.excludedParticipants.has(name)) return false;
            if (!appState.allowDuplicateWinners && appState.winners.has(name)) return false;
            return true;
        }).length;
    
    // 基本的な条件チェック
    const hasValidEvent = !!eventInfo.eventName;
    const hasValidWinnerCount = winnerCount > 0;
    const hasAvailableParticipants = availableParticipants > 0;
    const winnerCountNotExceedsAvailable = winnerCount <= availableParticipants;
    const notRunning = !appState.isLotteryRunning;
    
    
    const canStart = hasValidEvent && hasParticipants && hasValidWinnerCount && hasAvailableParticipants && winnerCountNotExceedsAvailable && notRunning;
    
    elements.startLotteryBtn.disabled = !canStart;
}


/**
 * UI要素のロック状態を更新
 */
function updateUILockState() {
    const isLocked = appState.isLotteryRunning;
    
    // 入力フィールドをロック
    elements.participantName.disabled = isLocked;
    elements.participantWeight.disabled = isLocked;
    elements.bulkInput.disabled = isLocked;
    elements.eventName.disabled = isLocked;
    elements.eventMonth.disabled = isLocked;
    elements.prizeName.disabled = isLocked;
    elements.winnerCount.disabled = isLocked;
    elements.excludedParticipantsTextarea.disabled = isLocked;
    elements.duplicateSettingSelect.disabled = isLocked;

    updateEventNameControls();

    // ボタンをロック
    elements.addParticipantBtn.disabled = isLocked;
    elements.addBulkBtn.disabled = isLocked;
    elements.resetAllBtn.disabled = isLocked;
    
    const setAllOneBtn = document.getElementById('set-all-one');
    if (setAllOneBtn) {
        setAllOneBtn.disabled = isLocked;
    }
    
    if (elements.lotteryTimeSelect) {
        elements.lotteryTimeSelect.disabled = isLocked;
    }
    
    // 削除・編集ボタンもロック
    const actionButtons = document.querySelectorAll('.participant-actions button');
    actionButtons.forEach(btn => {
        btn.disabled = isLocked;
    });
}

/**
 * 全データをリセット
 */
function resetAllData() {
    if (confirm('すべてのデータを削除しますか？この操作は取り消せません。')) {
        appState.participants.clear();
        elements.participantName.value = '';
        elements.participantWeight.value = '1';
        elements.bulkInput.value = '';
        elements.eventName.value = 'TEAM RED';
        elements.eventMonth.value = '';
        elements.prizeName.value = '抽選';
        elements.winnerCount.value = '1';
        appState.selectedTime = 5;
        appState.allowDuplicateWinners = false;
        appState.lastEventMonthSelection = '';
        appState.winners.clear();
        appState.winnerHistory = [];
        appState.excludedParticipants.clear();
        appState.lastResults = [];
        
        elements.excludedParticipantsTextarea.value = '';
        elements.duplicateSettingSelect.value = 'off';
        updateEventNameControls();
        updateWinnerHistoryDisplay();
        renderParticipantsList();
        updateParticipantsSummary();
        updateLotteryButtonState();
        updateExclusionStatusDisplay();
        elements.resultsCard.classList.remove('show');
        elements.lotteryResults.classList.remove('show');
        saveToStorage();
        
        clearError('participants-error');
        clearError('lottery-error');
        clearError('name-error');
        clearError('weight-error');
        clearError('event-error');
        clearError('count-error');
        
        localStorage.removeItem('lottery-app-data');
    }
}

// イベントリスナーを設定
document.addEventListener('DOMContentLoaded', function() {
    // 共有URLからの読み込みをチェック（最優先）
    const isSharedView = loadFromShareUrl();

    // ローカルストレージから復元
    loadFromStorage();

    // 月が設定されていない場合は現在の月を設定
    if (!elements.eventMonth.value) {
        const currentMonth = new Date().getMonth() + 1; // 0-11を1-12に変換
        elements.eventMonth.value = currentMonth.toString();
        appState.lastEventMonthSelection = currentMonth.toString();
    }

    updateEventNameControls();

    // タブ切り替え
    elements.tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.dataset.tab;
            
            // タブボタンの状態更新
            elements.tabButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // タブコンテンツの表示切り替え
            elements.tabContents.forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(targetTab + '-tab').classList.add('active');
            
            appState.currentTab = targetTab;
        });
    });
    
    // 参加者追加（単体）
    elements.addParticipantBtn.addEventListener('click', function() {
        const name = elements.participantName.value.trim();
        const weight = parseInt(elements.participantWeight.value, 10);
        
        clearError('name-error');
        clearError('weight-error');
        clearError('participants-error');
        
        // バリデーション
        if (!name) {
            showError('name-error', '名前を入力してください。');
            return;
        }
        
        if (isNaN(weight) || weight < 1) {
            showError('weight-error', '口数は1以上の整数で入力してください。');
            return;
        }
        
        // 参加者追加
        addOrMergeParticipant(name, weight);
        
        // フォームリセット
        elements.participantName.value = '';
        elements.participantWeight.value = '1';
        
        // 画面更新
        renderParticipantsList();
        updateParticipantsSummary();
        saveToStorage();
        
        // 名前入力にフォーカス
        elements.participantName.focus();
    });
    
    // Enterキーで追加
    elements.participantName.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            elements.addParticipantBtn.click();
        }
    });
    
    elements.participantWeight.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            elements.addParticipantBtn.click();
        }
    });
    
    // 参加者追加（一括）
    elements.addBulkBtn.addEventListener('click', function() {
        const text = elements.bulkInput.value.trim();
        
        clearError('participants-error');
        
        if (!text) {
            showError('participants-error', '参加者データを入力してください。');
            return;
        }
        
        try {
            const participants = parseBulkInput(text);
            
            if (participants.length === 0) {
                showError('participants-error', '有効な参加者データが見つかりません。');
                return;
            }
            
            // 参加者を一括追加
            participants.forEach(({ name, weight }) => {
                addOrMergeParticipant(name, weight);
            });
            
            // フォームリセット
            elements.bulkInput.value = '';
            
            // 画面更新
            renderParticipantsList();
            updateParticipantsSummary();
            saveToStorage();
            
        } catch (error) {
            showError('participants-error', '参加者データの処理中にエラーが発生しました。');
            console.error('Bulk input error:', error);
        }
    });
    
    // 抽選時間プルダウン
    elements.lotteryTimeSelect = document.getElementById('lottery-time');
    elements.lotteryTimeSelect.addEventListener('change', function() {
        appState.selectedTime = parseInt(this.value, 10);
        saveToStorage();
    });
    
    
    // 重複当選設定プルダウン
    elements.duplicateSettingSelect.addEventListener('change', function() {
        appState.allowDuplicateWinners = (this.value === 'on');
        updateAvailableParticipantsDisplay();
        updateLotteryButtonState();
        updateExclusionStatusDisplay();
        saveToStorage();
    });
    
    // 抽選開始
    elements.startLotteryBtn.addEventListener('click', startLottery);
    
    // 当選者コピー（詳細情報）
    elements.copyWinnersDetailedBtn.addEventListener('click', function() {
        copyWinnersDetailed();
    });
    


    // 共有URL生成
    const shareUrlBtn = document.getElementById('generate-share-url');
    if (shareUrlBtn) {
        shareUrlBtn.addEventListener('click', generateShareUrl);
    }

    // 抽選取り消し
    const cancelLotteryBtn = document.getElementById('cancel-lottery');
    if (cancelLotteryBtn) {
        cancelLotteryBtn.addEventListener('click', cancelLastLottery);
    }

    // 当選履歴リセット
    elements.resetWinnersBtn.addEventListener('click', function() {
        if (confirm('当選履歴をリセットしますか？（参加者リストや設定は保持されます）')) {
            appState.winners.clear();
            appState.winnerHistory = [];
            updateAvailableParticipantsDisplay();
            updateLotteryButtonState();
            updateWinnerHistoryDisplay();
            saveToStorage();
            
            // 結果表示を非表示に
            elements.resultsCard.classList.remove('show');
            elements.lotteryResults.classList.remove('show');
        }
    });
    
    // 全リセット
    elements.resetAllBtn.addEventListener('click', resetAllData);
    
    // 全て1口設定
    const setAllOneBtn = document.getElementById('set-all-one');
    if (setAllOneBtn) {
        setAllOneBtn.addEventListener('click', function() {
            if (appState.participants.size === 0) {
                alert('参加者が登録されていません。');
                return;
            }
            
            if (confirm('全ての参加者を1口に設定しますか？')) {
                for (const name of appState.participants.keys()) {
                    appState.participants.set(name, 1);
                }
                renderParticipantsList();
                updateParticipantsSummary();
                saveToStorage();
            }
        });
    }
    
    // 入力フィールドの変更を監視
    [elements.eventName, elements.eventMonth, elements.winnerCount].forEach(input => {
        input.addEventListener('input', function() {
            updateLotteryButtonState();
            saveToStorage();
        });
    });
    
    elements.eventName.addEventListener('change', function() {
        updateEventNameControls();
        updateLotteryButtonState();
        saveToStorage();
    });

    elements.eventMonth.addEventListener('change', function() {
        appState.lastEventMonthSelection = elements.eventMonth.value || '';
        updateLotteryButtonState();
        saveToStorage();
    });
    
    elements.prizeName.addEventListener('change', saveToStorage);
    
    
    // 除外対象者設定
    elements.excludedParticipantsTextarea.addEventListener('input', function() {
        updateExcludedParticipants();
    });
    
    // 初期状態の設定
    updateAvailableParticipantsDisplay();
    updateExclusionStatusDisplay();
    updateLotteryButtonState();

    // Discord通知の初期化
    initDiscordSettings();

    // リハーサルモードの初期化
    initRehearsalMode();

    // 参加者リストのエクスポート
    const exportParticipantsBtn = document.getElementById('export-participants');
    if (exportParticipantsBtn) {
        exportParticipantsBtn.addEventListener('click', exportParticipantsCSV);
    }

    // 参加者リストのインポート
    const importParticipantsBtn = document.getElementById('import-participants');
    const importFileInput = document.getElementById('import-file-input');

    if (importParticipantsBtn && importFileInput) {
        importParticipantsBtn.addEventListener('click', function() {
            importFileInput.click();
        });

        importFileInput.addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (file) {
                importParticipantsCSV(file);
                // ファイル選択をリセット（同じファイルを再度選択できるように）
                event.target.value = '';
            }
        });
    }

    // 現在時刻表示を開始
    startCurrentTimeDisplay();
});

/**
 * 日時をフォーマット
 * @param {Date} date - フォーマットする日時
 * @returns {string} フォーマット済み日時
 */
function formatDateTime(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 現在時刻を表示形式でフォーマット
 * @param {Date} date - フォーマットする日時
 * @returns {string} 表示用フォーマット済み日時
 */
function formatCurrentTime(date) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 現在時刻表示を更新
 */
function updateCurrentTime() {
    if (elements.currentTimeDisplay) {
        const now = new Date();
        elements.currentTimeDisplay.textContent = formatCurrentTime(now);
    }
}

/**
 * 現在時刻表示を開始
 */
function startCurrentTimeDisplay() {
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
}

/**
 * 当選履歴表示を更新
 */
function updateWinnerHistoryDisplay() {
    // 当選履歴表示エリアが存在しない場合は作成
    let historyContainer = document.getElementById('winner-history-container');
    if (!historyContainer) {
        historyContainer = document.createElement('div');
        historyContainer.id = 'winner-history-container';
        historyContainer.className = 'winner-history-container';
        historyContainer.innerHTML = `
            <h3 class="history-title">📋 当選履歴</h3>
            <div id="winner-history-list" class="winner-history-list"></div>
        `;
        elements.lotteryResults.appendChild(historyContainer);
    }
    
    const historyList = document.getElementById('winner-history-list');
    historyList.innerHTML = '';
    
    if (appState.winnerHistory.length === 0) {
        historyList.innerHTML = '<div class="no-history">当選履歴はありません</div>';
        return;
    }
    
    // 最新から順に表示し、同じ時間内では賞の優先度順でソート
    const sortedHistory = [...appState.winnerHistory].sort((a, b) => {
        // まず時系列でソート（新しい順）
        const timeComparison = new Date(b.timestamp) - new Date(a.timestamp);
        if (timeComparison !== 0) {
            return timeComparison;
        }
        
        // 同じ時間の場合は賞の優先度でソート（1等が上）
        return getPrizePriority(a.prize) - getPrizePriority(b.prize);
    });
    
    sortedHistory.forEach(record => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.innerHTML = `
            <div class="history-main">
                <span class="history-name">${escapeHtml(record.name)}</span>
                <span class="history-prize">${escapeHtml(record.prize)}</span>
            </div>
            <div class="history-meta">
                <span class="history-event">${escapeHtml(record.eventName)}</span>
                <span class="history-time">${record.displayTime}</span>
            </div>
        `;
        historyList.appendChild(historyItem);
    });
}


/**
 * スプレッドシート連携: 当選データを送信
 * @param {Array} winners - 当選者データの配列
 * @returns {Promise<boolean>} 送信成功時true
 */
async function sendToSpreadsheet(winners) {
    if (!appState.spreadsheetEnabled || !appState.spreadsheetUrl) {
        return false;
    }

    try {
        await fetch(appState.spreadsheetUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'text/plain',
            },
            body: JSON.stringify({ winners: winners })
        });
        return true;
    } catch (error) {
        console.error('スプレッドシート送信エラー:', error);
        return false;
    }
}

/**
 * スプレッドシート接続テスト
 */
async function testSpreadsheetConnection() {
    const urlInput = document.getElementById('spreadsheet-url');
    const statusMessage = document.getElementById('spreadsheet-status-message');
    const url = urlInput.value.trim();

    if (!url) {
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = 'URLを入力してください';
        return;
    }

    // URL形式チェック
    if (!url.startsWith('https://script.google.com/')) {
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = 'GAS WebアプリのURLを入力してください';
        return;
    }

    statusMessage.className = 'spreadsheet-status-message loading';
    statusMessage.textContent = '接続テスト中...';

    try {
        // テスト用のダミーデータを送信
        const testData = {
            winners: [{
                name: 'テスト',
                prize: '接続テスト',
                eventName: 'テスト',
                displayTime: new Date().toLocaleString('ja-JP'),
                timestamp: new Date().toISOString()
            }]
        };

        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testData)
        });

        // no-corsモードでは成功を確認できないが、エラーが出なければOK
        statusMessage.className = 'spreadsheet-status-message success';
        statusMessage.textContent = '✓ 接続成功！スプレッドシートを確認してください';

        // URLを保存
        appState.spreadsheetUrl = url;
        saveToStorage();

    } catch (error) {
        console.error('接続テストエラー:', error);
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = '✕ 接続失敗: ' + error.message;
    }
}

/**
 * Discord通知: 当選データを送信
 * @param {string} eventName - イベント名
 * @param {string} prizeName - 賞名
 * @param {Array} winners - 当選者名の配列
 * @returns {Promise<boolean>} 送信成功時true
 */
async function sendToDiscord(eventName, prizeName, winners) {
    if (!appState.discordEnabled || !appState.discordWebhookUrl) {
        return false;
    }

    const statusMessage = document.getElementById('discord-status-message');

    try {
        statusMessage.className = 'spreadsheet-status-message loading';
        statusMessage.textContent = '送信中...';

        // Discord Embed形式でメッセージを作成
        const embed = {
            title: `🎊 ${prizeName} 当選者発表 🎊`,
            description: `**${eventName}**\n\n当選者:\n${winners.map((name, index) => `${index + 1}. ${name}`).join('\n')}`,
            color: 0xff0000, // 赤色
            timestamp: new Date().toISOString(),
            footer: {
                text: 'TEAM RED'
            }
        };

        const response = await fetch(appState.discordWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });

        if (response.ok) {
            statusMessage.className = 'spreadsheet-status-message success';
            statusMessage.textContent = '✓ Discordに通知しました';

            setTimeout(() => {
                statusMessage.className = 'spreadsheet-status-message';
                statusMessage.textContent = '';
            }, 3000);

            return true;
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Discord送信エラー:', error);
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = '✕ 送信に失敗しました: ' + error.message;
        return false;
    }
}

/**
 * Discord接続テスト
 */
async function testDiscordConnection() {
    const urlInput = document.getElementById('discord-webhook-url');
    const statusMessage = document.getElementById('discord-status-message');
    const url = urlInput.value.trim();

    if (!url) {
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = 'URLを入力してください';
        return;
    }

    // URL形式チェック
    if (!url.startsWith('https://discord.com/api/webhooks/') && !url.startsWith('https://discordapp.com/api/webhooks/')) {
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = 'Discord Webhook URLを入力してください';
        return;
    }

    statusMessage.className = 'spreadsheet-status-message loading';
    statusMessage.textContent = '接続テスト中...';

    try {
        // テスト用のメッセージを送信
        const testEmbed = {
            title: '🔔 接続テスト',
            description: 'Discord通知機能の接続テストです。\nこのメッセージが表示されていれば接続成功です！',
            color: 0x00ff00, // 緑色
            timestamp: new Date().toISOString(),
            footer: {
                text: 'TEAM RED - 接続テスト'
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                embeds: [testEmbed]
            })
        });

        if (response.ok) {
            statusMessage.className = 'spreadsheet-status-message success';
            statusMessage.textContent = '✓ 接続成功！Discordを確認してください';

            // URLを保存
            appState.discordWebhookUrl = url;
            saveToStorage();
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

    } catch (error) {
        console.error('接続テストエラー:', error);
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = '✕ 接続失敗: ' + error.message;
    }
}

/**
 * Discord通知UIを初期化
 */
function initDiscordSettings() {
    const enabledCheckbox = document.getElementById('discord-enabled');
    const statusLabel = document.getElementById('discord-status');
    const urlContainer = document.getElementById('discord-url-container');
    const urlInput = document.getElementById('discord-webhook-url');
    const testBtn = document.getElementById('test-discord');

    if (!enabledCheckbox) return;

    enabledCheckbox.checked = appState.discordEnabled;
    statusLabel.textContent = appState.discordEnabled ? 'ON' : 'OFF';

    // 保存されたURLを復元
    if (urlInput && appState.discordWebhookUrl) {
        urlInput.value = appState.discordWebhookUrl;
    }
    if (urlContainer) {
        urlContainer.style.display = appState.discordEnabled ? 'flex' : 'none';
    }

    // トグル変更時
    enabledCheckbox.addEventListener('change', function() {
        appState.discordEnabled = this.checked;
        statusLabel.textContent = this.checked ? 'ON' : 'OFF';
        if (urlContainer) {
            urlContainer.style.display = this.checked ? 'flex' : 'none';
        }
        saveToStorage();
    });

    // URL入力時
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            appState.discordWebhookUrl = this.value.trim();
            saveToStorage();
        });
    }

    // 接続テストボタン
    if (testBtn) {
        testBtn.addEventListener('click', testDiscordConnection);
    }
}

/**
 * リハーサルモードUIを初期化
 */
function initRehearsalMode() {
    const checkbox = document.getElementById('rehearsal-enabled');
    const statusLabel = document.getElementById('rehearsal-status');
    const banner = document.getElementById('rehearsal-banner');

    if (!checkbox) return;

    // 現在の状態を反映
    checkbox.checked = appState.rehearsalMode;
    if (statusLabel) statusLabel.textContent = appState.rehearsalMode ? 'ON' : 'OFF';
    if (banner) banner.style.display = appState.rehearsalMode ? 'block' : 'none';

    // トグル変更時
    checkbox.addEventListener('change', function () {
        appState.rehearsalMode = this.checked;
        if (statusLabel) statusLabel.textContent = this.checked ? 'ON' : 'OFF';
        if (banner) banner.style.display = this.checked ? 'block' : 'none';
        saveToStorage();
    });
}

/**
 * Notionに当選者情報を記録
 * @param {string} eventName - イベント名
 * @param {string} prizeName - 賞名
 * @param {string} winnerName - 当選者名
 * @param {number} winnerWeight - 当選者の口数
 * @param {number} totalParticipants - 総参加者数
 * @param {number} totalWeight - 総口数
 * @returns {Promise<boolean>} 記録成功時true
 */
async function saveWinnerToNotion(eventName, prizeName, winnerName, winnerWeight, totalParticipants, totalWeight) {
    // GASプロキシURL
    const GAS_PROXY_URL = '';

    // GASプロキシURLまたはデータベースIDがない場合は静かにスキップ
    if (!GAS_PROXY_URL || !appState.notionDatabaseId) {
        return false;
    }

    try {
        // GASにリクエスト送信（エラーは静かに処理）
        await fetch(GAS_PROXY_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: JSON.stringify({
                parent: { database_id: appState.notionDatabaseId },
                properties: {
                    '名前': {
                        title: [{ text: { content: eventName } }]
                    },
                    '抽選日時': {
                        date: { start: new Date().toISOString() }
                    },
                    '賞名': {
                        select: { name: prizeName }
                    },
                    '当選者名': {
                        rich_text: [{ text: { content: winnerName } }]
                    },
                    '口数': {
                        number: winnerWeight
                    },
                    '総参加者数': {
                        number: totalParticipants
                    },
                    '総口数': {
                        number: totalWeight
                    }
                }
            })
        });
        return true;
    } catch (error) {
        console.error('Notion記録エラー:', error);
        return false;
    }
}

/**
 * Notion接続テスト
 */
async function testNotionConnection() {
    const tokenInput = document.getElementById('notion-token');
    const databaseIdInput = document.getElementById('notion-database-id');
    const statusMessage = document.getElementById('notion-status-message');

    const token = tokenInput.value.trim();
    const databaseId = databaseIdInput.value.trim();

    if (!token) {
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = 'Integration Tokenを入力してください';
        return;
    }

    if (!databaseId) {
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = 'データベースIDを入力してください';
        return;
    }

    statusMessage.className = 'spreadsheet-status-message loading';
    statusMessage.textContent = '接続テスト中...';

    try {
        const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28'
            }
        });

        if (response.ok) {
            const data = await response.json();
            statusMessage.className = 'spreadsheet-status-message success';
            statusMessage.textContent = '✓ 接続成功！データベース: ' + (data.title?.[0]?.plain_text || 'Untitled');

            // 設定を保存
            appState.notionToken = token;
            appState.notionDatabaseId = databaseId;
            saveToStorage();
        } else {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }

    } catch (error) {
        console.error('Notion接続テストエラー:', error);
        statusMessage.className = 'spreadsheet-status-message error';
        statusMessage.textContent = '✕ 接続失敗: ' + error.message;
    }
}

/**
 * スプレッドシート連携UIを初期化
 */
function initSpreadsheetSettings() {
    const enabledCheckbox = document.getElementById('spreadsheet-enabled');
    const urlContainer = document.getElementById('spreadsheet-url-container');
    const urlInput = document.getElementById('spreadsheet-url');
    const statusLabel = document.getElementById('spreadsheet-status');
    const testBtn = document.getElementById('test-spreadsheet');

    if (!enabledCheckbox) return;

    // 保存された設定を復元
    enabledCheckbox.checked = appState.spreadsheetEnabled;
    if (appState.spreadsheetUrl) {
        urlInput.value = appState.spreadsheetUrl;
    }
    urlContainer.style.display = appState.spreadsheetEnabled ? 'flex' : 'none';
    statusLabel.textContent = appState.spreadsheetEnabled ? 'ON' : 'OFF';

    // トグル変更時
    enabledCheckbox.addEventListener('change', function() {
        appState.spreadsheetEnabled = this.checked;
        urlContainer.style.display = this.checked ? 'flex' : 'none';
        statusLabel.textContent = this.checked ? 'ON' : 'OFF';
        saveToStorage();
    });

    // URL入力時
    urlInput.addEventListener('input', function() {
        appState.spreadsheetUrl = this.value.trim();
        saveToStorage();
    });

    // 接続テストボタン
    testBtn.addEventListener('click', testSpreadsheetConnection);
}

/**
 * UTF-8文字列をBase64にエンコード（日本語対応）
 * @param {string} str - エンコードする文字列
 * @returns {string} Base64文字列
 */
function utf8ToBase64(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
        binary += String.fromCharCode(utf8Bytes[i]);
    }
    return btoa(binary);
}

/**
 * Base64をUTF-8文字列にデコード（日本語対応）
 * @param {string} base64 - デコードするBase64文字列
 * @returns {string} デコードされた文字列
 */
function base64ToUtf8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

/**
 * 共有用データを生成
 * @returns {string} Base64エンコードされた共有データ
 */
function generateShareData() {
    const shareData = {
        v: 1, // バージョン（将来の互換性のため）
        h: appState.winnerHistory // 当選履歴
    };

    // JSON → Base64エンコード（URL safe）
    const jsonStr = JSON.stringify(shareData);
    const base64 = utf8ToBase64(jsonStr);
    // URL safeに変換
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * 共有データをパース
 * @param {string} base64Data - Base64エンコードされた共有データ
 * @returns {Object|null} パースされたデータまたはnull
 */
function parseShareData(base64Data) {
    try {
        // URL safeから通常のBase64に戻す
        let base64 = base64Data.replace(/-/g, '+').replace(/_/g, '/');
        // パディングを追加
        while (base64.length % 4) {
            base64 += '=';
        }

        const jsonStr = base64ToUtf8(base64);
        const data = JSON.parse(jsonStr);

        // バージョンチェック
        if (data.v !== 1) {
            console.warn('未対応の共有データバージョンです:', data.v);
            return null;
        }

        return data;
    } catch (e) {
        console.error('共有データのパースに失敗しました:', e);
        return null;
    }
}

/**
 * 共有URLを生成してクリップボードにコピー
 */
async function generateShareUrl() {
    if (appState.winnerHistory.length === 0) {
        alert('共有する当選履歴がありません。');
        return;
    }

    let shareData;
    try {
        shareData = generateShareData();
    } catch (e) {
        console.error('共有データの生成に失敗しました:', e);
        alert('共有データの生成に失敗しました。');
        return;
    }

    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const shareUrl = `${baseUrl}?share=${shareData}`;

    console.log('生成された共有URL:', shareUrl);
    console.log('URL長:', shareUrl.length);

    const btn = document.getElementById('generate-share-url');

    // クリップボードにコピーを試みる
    let copySuccess = false;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(shareUrl);
            copySuccess = true;
        }
    } catch (err) {
        console.warn('Clipboard API failed:', err);
    }

    // フォールバック
    if (!copySuccess) {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = shareUrl;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            copySuccess = document.execCommand('copy');
            document.body.removeChild(textArea);
        } catch (err) {
            console.warn('execCommand copy failed:', err);
        }
    }

    if (copySuccess) {
        // 成功フィードバック
        const originalText = btn.innerHTML;
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
            </svg>
            URLをコピーしました！
        `;

        setTimeout(() => {
            btn.innerHTML = originalText;
        }, 2000);
    } else {
        // コピーに失敗した場合はダイアログでURLを表示
        prompt('自動コピーできませんでした。以下のURLを手動でコピーしてください:', shareUrl);
    }
}

/**
 * URLパラメータから共有データを読み込み
 */
function loadFromShareUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const shareData = urlParams.get('share');

    if (!shareData) return false;

    const data = parseShareData(shareData);
    if (!data || !data.h || data.h.length === 0) {
        alert('共有データの読み込みに失敗しました。');
        return false;
    }

    // 共有モードで表示（既存データとマージせず、閲覧専用で表示）
    displaySharedResults(data.h);

    // URLパラメータをクリア（履歴を汚さないように）
    const cleanUrl = window.location.href.split('?')[0];
    window.history.replaceState({}, document.title, cleanUrl);

    return true;
}

/**
 * 共有された当選履歴を表示
 * @param {Array} sharedHistory - 共有された当選履歴
 */
function displaySharedResults(sharedHistory) {
    // 結果カードを表示
    elements.resultsCard.classList.add('show');
    elements.lotteryResults.classList.add('show');

    const resultsTitle = elements.lotteryResults.querySelector('.results-title');
    resultsTitle.textContent = '📤 共有された当選結果';

    // 当選者リストをクリア
    elements.winnersList.innerHTML = '';

    // 最新の当選者を表示
    const latestTimestamp = sharedHistory.length > 0 ? sharedHistory[sharedHistory.length - 1].timestamp : null;
    const latestWinners = sharedHistory.filter(r => r.timestamp === latestTimestamp);

    latestWinners.forEach((record, index) => {
        const winnerItem = document.createElement('div');
        winnerItem.className = 'winner-item';
        winnerItem.innerHTML = `<span class="winner-name">${escapeHtml(record.name)}</span>`;
        winnerItem.style.animationDelay = `${index * 0.1}s`;
        elements.winnersList.appendChild(winnerItem);
    });

    // 共有履歴を表示
    displaySharedHistory(sharedHistory);

    // 結果カードにスクロール
    setTimeout(() => {
        elements.resultsCard.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }, 300);
}

/**
 * 共有された当選履歴一覧を表示
 * @param {Array} sharedHistory - 共有された当選履歴
 */
function displaySharedHistory(sharedHistory) {
    let historyContainer = document.getElementById('winner-history-container');
    if (!historyContainer) {
        historyContainer = document.createElement('div');
        historyContainer.id = 'winner-history-container';
        historyContainer.className = 'winner-history-container';
        historyContainer.innerHTML = `
            <h3 class="history-title">📋 共有された当選履歴</h3>
            <div id="winner-history-list" class="winner-history-list"></div>
        `;
        elements.lotteryResults.appendChild(historyContainer);
    } else {
        historyContainer.querySelector('.history-title').textContent = '📋 共有された当選履歴';
    }

    const historyList = document.getElementById('winner-history-list');
    historyList.innerHTML = '';

    // 最新から順に表示
    const sortedHistory = [...sharedHistory].sort((a, b) => {
        const timeComparison = new Date(b.timestamp) - new Date(a.timestamp);
        if (timeComparison !== 0) return timeComparison;
        return getPrizePriority(a.prize) - getPrizePriority(b.prize);
    });

    sortedHistory.forEach(record => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.innerHTML = `
            <div class="history-main">
                <span class="history-name">${escapeHtml(record.name)}</span>
                <span class="history-prize">${escapeHtml(record.prize)}</span>
            </div>
            <div class="history-meta">
                <span class="history-event">${escapeHtml(record.eventName)}</span>
                <span class="history-time">${record.displayTime}</span>
            </div>
        `;
        historyList.appendChild(historyItem);
    });
}

// グローバル関数として公開（HTMLから呼び出すため）
window.editParticipant = editParticipant;
window.removeParticipant = removeParticipant;
window.debugDistribution = debugDistribution;
window.generateShareUrl = generateShareUrl;
