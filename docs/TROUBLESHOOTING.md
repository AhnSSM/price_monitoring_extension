# 문제 해결

LLM 또는 coding agent가 문제 해결을 도울 경우 [LLM 설치 지원 가이드](LLM_ASSISTED_INSTALL.md)의 금지 사항을 먼저 따릅니다. 특히 비밀 인증값을 채팅, 로그, screenshot에 남기지 않습니다.

## popup 메시지별 조치

| 메시지 | 의미 | 조치 |
|--------|------|------|
| `활성 탭을 찾을 수 없습니다.` | 브라우저가 현재 탭 정보를 못 줌 | Coupang 탭을 활성화하고 popup을 다시 열기 |
| `www.coupang.com 상품 상세 페이지에서만 사용할 수 있습니다.` | 현재 탭이 `https://www.coupang.com/vp/products/*`가 아님 | Coupang 상품 상세 페이지에서 실행 |
| `보이는 본문 텍스트가 비어 있습니다.` | page body text가 비어 있음 | 페이지 로드 완료 후 재시도, captcha/blocked page 여부 확인 |
| `서버가 이 확장 버전을 거부했습니다. 업데이트 또는 재설치 후 자동 송신을 다시 켜세요.` | 서버가 `unsupported_extension_version` 또는 `extension_version_mismatch`를 반환 | 확장 reload 또는 재설치 후 다시 ON, 서버 허용 버전이 `0.2.0`인지 확인 |
| `같은 상품 자동 송신을 최근 10분 안에 이미 보냈습니다.` | dedup suppression이 동작함 | 같은 상품을 다시 자동 전송할 필요가 없으면 그대로 두고, 즉시 재전송이 필요하면 수동 `현재 페이지 저장` 사용 |
| `전송 실패: HTTP 401` | 서버 gate 또는 배포 상태 불일치 가능성 | 서버 origin, source gate, 배포 상태 확인 |
| `전송 실패: HTTP 403` | 서버 정책 차단 가능성 | Tailscale 접속 상태, source gate, 서버 로그 확인 |
| `전송 실패: HTTP 404` | API path 또는 서버 버전 불일치 | 서버가 최신 detail import API를 포함하는지 확인 |
| `전송 실패: HTTP 5xx` | 서버 내부 오류 | 서버 로그 확인 |

## 확장이 보이지 않을 때

1. `brave://extensions` 또는 `chrome://extensions`를 엽니다.
2. Developer mode가 켜져 있는지 확인합니다.
3. `Load unpacked`에서 `manifest.json`이 있는 repo root를 선택했는지 확인합니다.
4. 확장 카드의 오류 버튼이 있으면 내용을 확인합니다.

## 코드 변경 후 반영이 안 될 때

압축해제 확장은 파일을 바꿔도 자동 reload되지 않을 수 있습니다.

1. `brave://extensions` 또는 `chrome://extensions`를 엽니다.
2. `Coupang Detail Import` 카드의 reload 버튼을 누릅니다.
3. 열려 있던 popup을 닫고 다시 엽니다.
4. Coupang page도 새로고침한 뒤 다시 시도합니다.

## 설정을 초기화하고 싶을 때

가장 단순한 방법은 확장을 제거하고 다시 로드하는 것입니다. 자동 송신 상태와 최근 상태도 함께 초기화됩니다.

## 서버 연결 확인

서버가 떠 있는지 먼저 확인합니다.

```bash
curl -i http://100.118.184.5:5000/
```

이 응답이 오면 기본 서버 origin 자체는 열려 있다는 뜻입니다. 실제 import 처리까지 확인하려면 확장에서 수동 전송 후 서버 로그를 확인합니다.

## 미관리 inbox 응답

자동 송신 뒤 popup 최근 상태가 `미관리 inbox`로 표시되면, 확장 전송 자체는 성공했지만 서버가 해당 상품을 모니터링 대상에 매핑하지 않았다는 뜻입니다.

이 경우 서버 `price_monitoring v0.1.7` 운영 화면에서 unmanaged inbox를 확인해야 합니다. 확장은 새 관리 상품을 만들거나 승격하지 않습니다.
