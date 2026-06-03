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
  "extension_version": "0.2.0",
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

## 언제 버튼을 눌러야 하나

아래 상황에서 수동으로 누릅니다.

- 서버 직접 상세 확인이 `Access Denied`, captcha, navigation failure로 실패한 경우.
- 사용자가 실제 브라우저에서 Coupang 상세 페이지를 정상 확인할 수 있는 경우.
- 특정 watch/spec의 상세 텍스트를 서버에 보강하고 싶은 경우.

## 자동 동작하지 않는 것

이 확장은 아래 동작을 하지 않습니다.

- background crawling.
- 자동 페이지 순회.
- Coupang 로그인 정보 수집.
- cookie 또는 브라우저 저장소 수집.
- screenshot capture.
- 서버 설정 변경.

## 데이터 범위

현재 탭에서 아래 payload만 만듭니다.

```json
{
  "extension_version": "0.2.0",
  "source": "manual_popup 또는 auto_page_view",
  "url": "브라우저 탭 URL",
  "final_url": "페이지에서 읽은 최종 URL",
  "title": "문서 제목",
  "text": "document.body.innerText"
}
```

`text`가 비어 있으면 전송하지 않고 popup에서 오류를 표시합니다.
