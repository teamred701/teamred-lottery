const EVENT_SHEET_MAP = [
  { keyword: 'TEAM RED',  gid: 791893371   },
  { keyword: 'SPORTS of HEART',     gid: 1503747792  },
  { keyword: '赤犬赤猫',             gid: 1666831781  },
  { keyword: 'ゆるトークン',          gid: 1044685026  },
  { keyword: 'Scent Japan DAO',     gid: 142347598   },
  { keyword: 'CNPRED',              gid: 1986463978  },
  { keyword: 'LEVELUP',             gid: 1945849523  },
  { keyword: '複業アカデミー',         gid: 2080242223  },
];

const SPREADSHEET_ID = '1kD-JYN68-tJ_2sb93eQqG6U8VNBGT5Ty19aWJGG3Byc';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const winners = data.winners || [];

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const mainSheet = ss.getSheets()[0];

    winners.forEach(function(winner) {
      const row = [
        winner.displayTime || new Date().toLocaleString('ja-JP'),
        winner.eventName   || '',
        winner.prize       || '',
        winner.name        || ''
      ];

      mainSheet.appendRow(row);

      const eventName = winner.eventName || '';
      for (var i = 0; i < EVENT_SHEET_MAP.length; i++) {
        if (eventName.indexOf(EVENT_SHEET_MAP[i].keyword) !== -1) {
          const targetSheet = getSheetByGid(ss, EVENT_SHEET_MAP[i].gid);
          if (targetSheet) {
            targetSheet.appendRow(row);
          }
          break;
        }
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('エラー: ' + error.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) {
      return sheets[i];
    }
  }
  return null;
}

function testDoPost() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        winners: [{
          name: 'テスト太郎',
          prize: 'テスト賞',
          eventName: '複業アカデミー 3月抽選会',
          displayTime: new Date().toLocaleString('ja-JP'),
          timestamp: new Date().toISOString()
        }]
      })
    }
  };
  const result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
