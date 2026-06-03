# 설정값과 서버 연결

확장 popup은 운영 서버 origin을 읽기 전용으로 보여 줍니다. 사용자가 별도 값을 입력하지 않습니다. 자동 송신 ON/OFF와 최근 자동 상태는 `chrome.storage.local`에 운영 상태로만 저장합니다.

| 항목 | 예시 | 설명 |
|------|------|------|
| 서버 URL | `http://100.118.184.5:5000` | `price_monitoring` 서버 origin입니다. popup에 고정 표시됩니다. |

## 허용된 서버 origin

현재 허용된 서버 origin은 다음과 같습니다.

- `http://100.118.184.5:5000`
- 허용 목록은 두 곳에서 함께 관리합니다.

- `manifest.json`의 `host_permissions`
- `popup.js`의 `SERVER_URL`/`SERVER_ORIGIN`

새 Tailscale IP, hostname, 또는 port를 쓰려면 두 파일을 같이 수정하고 브라우저 확장 목록에서 reload해야 합니다.

## 서버 API 전제

확장은 아래 path로 POST 요청을 보냅니다.

```text
/api/dedicated/coupang_apple_return_sale/detail-check/import
```

요청 header:

```text
Content-Type: application/json
```

요청 header:

```text
Content-Type: application/json
X-Price-Monitoring-Extension-Version: 0.2.0
```

요청 body는 현재 Coupang 탭에서 수집한 아래 값입니다.

```json
{
  "extension_version": "0.2.0",
  "source": "manual_popup 또는 auto_page_view",
  "url": "...",
  "final_url": "...",
  "title": "...",
  "text": "..."
}
```

## 자동 송신 상태 저장

`chrome.storage.local`에 저장하는 값은 운영 상태만 포함합니다.

| Key | 타입 | 설명 |
|-----|------|------|
| `autoModeEnabled` | boolean | 자동 송신 토글 상태. 기본 `false`. |
| `autoDedupMetadata` | object | 최근 10분 dedup key와 timestamp. |
| `lastAutoStatus` | object | 최근 자동 송신 결과 메시지, tone, 시각. |

cookie, 자격 증명, 브라우저 저장소 내용, full HTML은 저장하지 않습니다.
