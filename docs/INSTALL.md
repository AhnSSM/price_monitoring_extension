# 설치와 업데이트

이 확장 프로그램은 Chrome Web Store 또는 Brave 공식 스토어에 배포하지 않습니다. 사용자는 GitHub에서 source를 받아 브라우저의 압축해제 확장 프로그램으로 직접 로드합니다.

LLM 또는 coding agent가 설치를 도와주는 경우에는 [LLM 설치 지원 가이드](LLM_ASSISTED_INSTALL.md)를 먼저 읽어야 합니다.

## 1. 받기

```bash
cd /home/kth/workspace
git clone git@github.com:AhnSSM/price_monitoring_extension.git
```

SSH key가 설정되어 있지 않은 환경에서는 HTTPS로 받을 수 있습니다.

```bash
cd /home/kth/workspace
git clone https://github.com/AhnSSM/price_monitoring_extension.git
```

이미 clone한 적이 있으면 새로 clone하지 말고 업데이트만 합니다.

```bash
git -C /home/kth/workspace/price_monitoring_extension pull
```

## 2. Brave에 설치

1. 주소창에 `brave://extensions`를 입력합니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 클릭합니다.
4. `/home/kth/workspace/price_monitoring_extension` 폴더를 선택합니다.
5. 확장 목록에 `Coupang Detail Import`가 보이는지 확인합니다.

## 3. Chrome에 설치

1. 주소창에 `chrome://extensions`를 입력합니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램 로드`를 클릭합니다.
4. `/home/kth/workspace/price_monitoring_extension` 폴더를 선택합니다.
5. 확장 목록에 `Coupang Detail Import`가 보이는지 확인합니다.

## 4. 업데이트

source를 업데이트한 뒤 브라우저 확장 목록에서 reload 버튼을 눌러야 합니다.

```bash
git -C /home/kth/workspace/price_monitoring_extension pull
```

그 다음:

1. `brave://extensions` 또는 `chrome://extensions`를 엽니다.
2. `Coupang Detail Import` 카드의 reload 버튼을 누릅니다.
3. popup을 새로 열어 서버 URL과 자동 송신 기본 OFF 상태를 확인합니다.
4. 필요하면 자동 송신을 다시 켜고 최근 자동 상태가 정상 표시되는지 확인합니다.

## 5. 제거

브라우저 확장 목록에서 `Coupang Detail Import`를 제거합니다.

source checkout 삭제는 사용자가 명시적으로 요청했을 때만 진행합니다. 삭제 전에 Git에 올리지 않은 로컬 변경이 없는지 확인하세요.

```bash
git -C /home/kth/workspace/price_monitoring_extension status --short
```

사용자가 삭제를 확인한 경우에만 아래 명령을 사용합니다.

```bash
rm -rf /home/kth/workspace/price_monitoring_extension
```
