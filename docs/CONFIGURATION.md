# 설정값과 서버 연결

확장 popup은 운영 서버 origin을 읽기 전용으로 보여 줍니다. 사용자가 별도 값을 입력하지 않습니다.

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

요청 body는 현재 Coupang 탭에서 수집한 `url`, `final_url`, `title`, `text`입니다.
