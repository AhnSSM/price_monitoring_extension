# 사용 절차

## 기본 흐름

### 수동 `현재 페이지 저장`

1. Brave 또는 Chrome에서 Coupang 상품 상세 페이지를 엽니다.
2. 툴바에서 `Coupang Detail Import` 확장 아이콘을 누릅니다.
3. popup에 고정 표시된 서버 URL이 현재 운영 Tailscale origin과 같은지 확인합니다.
4. `현재 페이지 저장`을 누릅니다.
5. popup 상태 메시지를 확인합니다.
6. `price_monitoring` 서버 UI 또는 로그에서 import 결과를 확인합니다.

수동 요청은 항상 아래 metadata를 함께 보냅니다.

```json
{
  "extension_version": "0.4.0",
  "source": "manual_popup"
}
```

### 자동 송신

1. popup에서 `자동 송신` toggle을 ON으로 바꿉니다.
2. `https://www.coupang.com/vp/products/*` 상품 상세 페이지를 엽니다.
3. 페이지가 보인 뒤 잠시 후 background가 한 번 자동 송신을 시도합니다.
4. popup을 다시 열어 최근 자동 송신 상태를 확인합니다.

중요 동작:

- 기본값은 OFF입니다.
- 최근 10분 내 같은 `productId/itemId/vendorItemId` 또는 canonical URL은 자동 중복 POST하지 않습니다.
- 서버가 `unsupported_extension_version` 또는 `extension_version_mismatch`를 반환하면 자동 송신이 OFF로 전환되고 업데이트/재설치 필요 상태가 표시됩니다.
- 서버가 관리하지 않는 상품이면 자동 송신 성공 대신 `unmanaged_queued`로 기록될 수 있습니다.
- 자동 송신 경로에는 current-list batch의 `force mode`가 적용되지 않습니다.

### current-list batch runner

`v0.3.0`부터는 서버 current-list 페이지가 primary trigger입니다. `v0.4.0`은 current-list batch의 기본 세션 모드를 `incognito`(시크릿/프라이빗 창)로 두고, 각 라운드마다 새로운 시크릿 창을 열어(`sessionRotation: "per_round"`) 작업한 뒤 닫습니다. 라운드 크기는 8-12개 사이 랜덤, 라운드 안의 탭 사이 간격은 0.3-1.0초 랜덤, 라운드 사이 대기는 10-20초 랜덤입니다. 마지막 라운드는 남은 후보 수로 자동 clamp 됩니다. 서버가 명시적으로 `sessionMode: "regular"`를 함께 보낸 경우에만 일반 창 fallback을 사용합니다.

사전 준비:

1. `brave://extensions`(또는 `chrome://extensions`)에서 `Coupang Detail Import` 카드의 `Details` 버튼을 엽니다.
2. **Brave**: `Allow in Private / 시크릿 허용`을 켭니다. **Chrome**: `Allow in Incognito / 시크릿 모드에서 허용`을 켭니다.
3. 끄면 `v0.4.0`의 기본 current-list batch는 시크릿 창을 열 수 없어 즉시 `incognito_not_allowed`로 실패합니다.

진행 절차:

1. current-list 페이지에서 `갱신 필요 상품 확인` 또는 `상단 30개 강제 갱신` 버튼을 누릅니다.
2. 페이지는 bridge content script에 `pm:ping`을 보내 설치/버전을 확인합니다.
3. 버전이 `0.4.0`이고 시크릿 창이 허용돼 있으면 페이지가 현재 필터/정렬과 갱신 옵션을 반영해 batch payload를 만듭니다. force mode는 freshness/최근 품절 제외를 무시하지만 URL 없음/미지원 URL은 계속 제외합니다.
4. 페이지가 선택한 최대 30개 candidate, batch id, 라운드 크기(roundSizeMin/roundSizeMax/roundSizeMode), 인터-라운드 옵션, 그리고 세션 모드(`sessionMode`/`sessionRotation`)를 extension으로 전달합니다. 서버가 세션 모드를 보내지 않으면 extension은 기본값(`incognito` + `per_round`)을 사용합니다.
5. extension background는 세션 모드가 `incognito`이면 라운드 시작 시 새 시크릿 창을 만들고, 그 안에서만 8-12개 사이 랜덤 크기로 탭을 비활성으로 엽니다. 첫 탭 이후 다음 탭은 0.3-1.0초 랜덤 간격으로 순차 오픈되며, 마지막 라운드는 남은 후보 수로 자동 clamp 됩니다. 라운드 종료 시 background는 그 라운드의 시크릿 창을 닫고 다음 라운드를 위해 새 시크릿 창을 다시 엽니다.
6. 각 탭 payload는 기존 detail import API로 `source: "auto_page_view"` 전송됩니다.
7. 라운드 사이에는 10-20초 사이 랜덤 시간 동안 background가 쉬고, 이 동안 popup은 `다음 라운드 대기 중 (약 N초 뒤 자동 재개)` 상태로 batch 카드를 보여 줍니다.
8. 차단/캡차 응답이 한 건이라도 들어오면 batch는 즉시 `중단됨 — 차단/캡차 감지로 자동 중단` 상태가 되고, 미실행 항목은 `skipped`로 분류됩니다. 차단/캡차로 중단된 경우 background는 현재 라운드의 시크릿 창을 닫고, batch가 만든 모든 시크릿 창을 정리한 뒤 `closedOwnedWindows` 카운트를 popup에 노출합니다.
9. 페이지 또는 popup에서 최근 batch 상태를 확인합니다. popup `최근 current-list batch` 카드는 `모드 시크릿(라운드별 새 시크릿 창) · 라운드 N/M · 닫은 시크릿 창 K개` 같은 요약을 함께 보여 줍니다.

중요 동작:

- 이미 batch가 실행 중이면 새 시작 요청은 거부됩니다.
- extension이 연 batch 탭과 라운드별 시크릿 창만 닫습니다.
- 사용자 일반 창은 절대 닫지 않습니다.
- `stop-on-block`은 batch 단위로 항상 기본 ON입니다.
- batch 상태는 `chrome.storage.local.currentListBatchStatus`에 최신 transient 상태만 남깁니다. 상태 값은 `running`, `waiting`, `stopped`, `completed`, `failed` 중 하나이며, 시크릿 미허용으로 실패한 `failed`는 `errorCode: "incognito_not_allowed"`로 구분됩니다.

## 정상 성공 메시지

수동 전송이 성공하면 popup에 아래 의미의 메시지가 표시됩니다.

```text
가져오기를 요청했습니다. 서버에서 결과를 확인하세요.
```

이 메시지는 브라우저에서 서버 import API 호출이 성공했다는 뜻입니다. 서버가 이후 해당 page text를 어떻게 분류했는지는 서버 UI에서 확인해야 합니다.

자동 송신 최근 상태는 popup의 `자동 송신` 카드에 남습니다. 대표 예시는 아래와 같습니다.

- `자동 송신이 서버에 접수됐습니다.`
- `자동 송신이 접수됐고 서버가 미관리 inbox로 분류했습니다.`
- `같은 상품 자동 송신을 최근 10분 안에 이미 보냈습니다.`
- `서버가 이 확장 버전을 거부했습니다. 업데이트 또는 재설치 후 자동 송신을 다시 켜세요.`

current-list batch 상태는 popup의 `최근 current-list batch` 카드에 남습니다. 대표 예시는 아래와 같습니다.

- `batch 진행 중 · clb_<id> · 성공 N · 실패 M · 건너뜀 K · 차단 B · X/Y 완료 · 최근 라운드 8개 · [모드 시크릿(라운드별 새 시크릿 창) · 라운드 2/3] (MM-DD HH:mm)`
- `다음 라운드 대기 중 (약 14초 뒤 자동 재개) · clb_<id> · 성공 N · 실패 M · 건너뜀 K · 차단 B · X/Y 완료 · [모드 시크릿(라운드별 새 시크릿 창) · 라운드 2/3] (MM-DD HH:mm)`
- `batch 중단됨 — 차단/캡차 감지로 자동 중단 · clb_<id> · ... · [모드 시크릿(라운드별 새 시크릿 창) · 닫은 시크릿 창 1개] (MM-DD HH:mm)`
- `batch 실패 — 시크릿 창 허용 필요 · clb_<id> · ... · [모드 시크릿(라운드별 새 시크릿 창) · brave://extensions에서 'Allow in Private' 활성화 필요] (MM-DD HH:mm)`
- `batch 최근 결과 · clb_<id> · 성공 N · 실패 M · 건너뜀 K · 차단 0 · X/Y 완료 · [모드 시크릿(라운드별 새 시크릿 창)] (MM-DD HH:mm)`

서버가 명시적으로 `sessionMode: "regular"`를 보낸 경우에만 popup의 `모드`는 `모드 일반(서버가 명시 요청한 경우에만)`으로 표시되고, 일반 창 fallback이 사용된다는 안내는 서버가 regular 모드를 요구한 사실 자체로만 표기됩니다.

## 팁

- `v0.4.0`은 시크릿 창 회전이 핵심 동작입니다. Brave/Chrome 확장 카드의 `Allow in Private / Allow in Incognito`가 꺼져 있으면 어떤 current-list batch도 시작되지 않으니 가장 먼저 확인합니다.
- batch가 도중에 멈추면 popup의 `closedOwnedWindows`/`closedOwnedWindowsSkipped` 수치로 정리 상태를 확인합니다. 수치가 0이면 시크릿 창이 사용자 작업 중에 남았을 수 있으니 필요 시 직접 닫아도 무방합니다.
- 시크릿 창 회전은 사용자의 일반 브라우징 세션과 분리됩니다. 사용자가 평소 쓰던 쿠키/세션은 건드리지 않습니다.
- popup은 current-list 페이지가 보내는 payload의 `sessionMode`/`sessionRotation`을 따르고, 서버가 보내지 않은 경우 기본값을 적용합니다.

## 자동 송신과 batch의 차이

- 자동 송신: 사용자가 상품 페이지를 열 때 한 번 보내는 1회성 POST. 현재 활성 탭의 visible text만 보냅니다. 시크릿 창 회전과 무관합니다.
- current-list batch: 서버 current-list 페이지가 후보 N개를 보내면 extension이 라운드 단위로 시크릿 창 회전 + 탭 자동 오픈 + import API 호출을 수행합니다.
