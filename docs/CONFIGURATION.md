# 설정값과 서버 연결

확장 popup은 운영 서버 origin을 읽기 전용으로 보여 줍니다. 사용자가 별도 값을 입력하지 않습니다. 자동 송신 ON/OFF와 최근 자동 상태는 `chrome.storage.local`에 운영 상태로만 저장합니다.

| 항목 | 예시 | 설명 |
|------|------|------|
| 서버 URL | `http://100.118.184.5:5000` | `price_monitoring` 서버 origin입니다. popup에 고정 표시됩니다. |
| 확장 버전 | `0.4.2` | popup 헤더와 import 요청 `extension_version`, 진단용 `X-Price-Monitoring-Extension-Version` header에 함께 실립니다. |
| 시크릿/프라이빗 허용 | Brave `Allow in Private` / Chrome `Allow in Incognito` | `v0.4.1`의 기본 current-list batch는 시크릿 창에서 실행되므로 반드시 켜져 있어야 합니다. |

## 허용된 서버 origin

현재 허용된 서버 origin은 다음과 같습니다.

- `http://100.118.184.5:5000`
- 허용 목록은 두 곳에서 함께 관리합니다.

- `manifest.json`의 `host_permissions`
- `popup.js`의 `SERVER_URL`/`SERVER_ORIGIN`

새 Tailscale IP, hostname, 또는 port를 쓰려면 두 파일을 같이 수정하고 브라우저 확장 목록에서 reload해야 합니다.

## current-list batch 기본값 (`v0.4.1`)

| 항목 | 기본값 | 출처 |
|------|--------|------|
| 세션 모드 (`sessionMode`) | `incognito` | 서버가 명시하지 않으면 extension 기본값. 일반 창 fallback은 서버가 `regular`를 명시한 경우에만. |
| 세션 회전 (`sessionRotation`) | `per_round` | 라운드마다 새 시크릿 창 회전. |
| 라운드 크기 | 8-12 사이 랜덤 | 서버 `roundSizeMin`/`roundSizeMax`/`roundSizeMode` 수용. |
| 인터-라운드 대기 | 10-20초 사이 랜덤 | 서버 `waveSleepMin`/`waveSleepMax`/`waveSleepMode` 수용. |
| 탭 오픈 간격 | 0.3-1.0초 사이 랜덤 | 라운드 내부 `tabs.create` 사이의 랜덤 간격. |
| 후보 상한 | 30 | background가 한 번에 처리할 최대 candidate. |
| stop-on-block | 항상 ON | batch 단위 자동 중단 + 미실행 항목 `skipped` 분류. |

## 시크릿/프라이빗 창 허용 설정

`v0.4.1`의 기본 current-list batch는 시크릿 창을 사용합니다. 다음 절차로 허용합니다.

1. `brave://extensions` 또는 `chrome://extensions`를 엽니다.
2. `Coupang Detail Import` 카드의 `Details` 버튼을 엽니다.
3. **Brave**: `Allow in Private / 시크릿 허용` 체크박스를 켭니다.
4. **Chrome**: `Allow in Incognito / 시크릿 모드에서 허용` 체크박스를 켭니다.
5. 변경 후 확장 카드의 `Reload` 버튼을 눌러 반영합니다.

이 설정이 꺼져 있으면 batch 시작 시 `errorCode: "incognito_not_allowed"`로 즉시 실패하고, popup `최근 current-list batch` 카드는 `시크릿 창 허용 필요` 상태와 `확장 세부정보에서 Brave 'Allow in Private' 또는 Chrome 'Allow in Incognito' 활성화 필요` 안내를 함께 보여 줍니다.

## 서버 API 전제

확장은 아래 path로 POST 요청을 보냅니다.

```text
/api/dedicated/coupang_apple_return_sale/detail-check/import
```

요청 header:

```text
Content-Type: application/json
X-Price-Monitoring-Extension-Version: 0.4.2
```

요청 body는 현재 Coupang 탭에서 수집한 아래 값입니다.

```json
{
  "extension_version": "0.4.2",
  "source": "manual_popup 또는 auto_page_view",
  "url": "...",
  "final_url": "...",
  "title": "...",
  "text": "..."
}
```

서버는 `extension_version: "0.4.2"`을 수용하는 `price_monitoring v0.2.0+`이어야 합니다. 서버가 `unsupported_extension_version` 또는 `extension_version_mismatch`를 반환하면 자동 송신은 OFF로 전환되고, current-list batch는 거부됩니다.

## 자동 송신 상태 저장

`chrome.storage.local`에 저장하는 값은 운영 상태만 포함합니다.

| Key | 타입 | 설명 |
|-----|------|------|
| `autoModeEnabled` | boolean | 자동 송신 토글 상태. 기본 `false`. |
| `autoDedupMetadata` | object | 최근 10분 dedup key와 timestamp. |
| `lastAutoStatus` | object | 최근 자동 송신 결과 메시지, tone, 시각. |
| `currentListBatchStatus` | object | 최근 current-list batch transient 상태. `state`, `summary`, `sessionMode`, `sessionRotation`, `sessionModeIsPrivate`, `closedOwnedTabs`, `closedOwnedWindows`, `closedOwnedWindowsSkipped`, `errorCode`, `lastRoundSize` 등을 보관. |

cookie, 자격 증명, 브라우저 저장소 내용, full HTML은 저장하지 않습니다. 토큰/쿠키 수집 코드나 쿠키 조회 API 사용은 없습니다.
