# 사용 절차

## 기본 흐름

1. Brave 또는 Chrome에서 Coupang 상품 상세 페이지를 엽니다.
2. 툴바에서 `Coupang Detail Import` 확장 아이콘을 누릅니다.
3. 서버 URL과 Bearer token이 입력되어 있는지 확인합니다.
4. `현재 페이지 저장`을 누릅니다.
5. popup 상태 메시지를 확인합니다.
6. `price_monitoring` 서버 UI 또는 로그에서 import 결과를 확인합니다.

## 정상 성공 메시지

전송이 성공하면 popup에 아래 의미의 메시지가 표시됩니다.

```text
가져오기를 요청했습니다. 서버에서 결과를 확인하세요.
```

이 메시지는 브라우저에서 서버 import API 호출이 성공했다는 뜻입니다. 서버가 이후 해당 page text를 어떻게 분류했는지는 서버 UI에서 확인해야 합니다.

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
- cookie 또는 localStorage 수집.
- screenshot capture.
- 서버 설정 변경.

## 데이터 범위

현재 탭에서 아래 payload만 만듭니다.

```json
{
  "url": "브라우저 탭 URL",
  "final_url": "페이지에서 읽은 최종 URL",
  "title": "문서 제목",
  "text": "document.body.innerText"
}
```

`text`가 비어 있으면 전송하지 않고 popup에서 오류를 표시합니다.
