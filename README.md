# ranpicker - 임직원 랜덤 선정 웹앱

GitHub Pages에 무료 배포할 수 있는 정적 웹앱입니다. Google 로그인은 Firebase Authentication, 데이터 저장은 Cloud Firestore를 사용합니다.

## 포함 기능

- Google 계정 로그인
- 게스트 로그인 조회 모드
- 회사 공용 Gmail 1개로 로그인한 사용자만 Pool/랜덤설정 수정 가능
- 게스트/일반 계정은 Pool과 이력 조회만 가능
- 최초 로그인 후 XLSX 임직원 목록 입력
- XLSX 열 순서: 이름, 소속, 직위, 이메일
- 기존 5열 양식도 보조 지원: 이름, 소속, 직위, 전화번호, 이메일
- Pool 탭에서 이름, 소속, 직위, 전화번호, 이메일, 활성여부, 참여횟수, 최근참여일 수정
- 랜덤설정 입력값: 사업명, 평가일, 추출 인원 수, 최근참여 제외일수
- 양수가 아닌 추출 인원 수/제외일수 경고 처리
- 최근 N일 이내 참여자 제외 후 랜덤 선정
- 선정 결과 저장 시 참여횟수/최근참여일 자동 갱신
- 마이페이지에서 사업명 목록 및 사업별 선정 결과 조회

## Firebase 설정

1. Firebase Console에서 새 프로젝트를 만듭니다.
2. Authentication > Sign-in method에서 Google 로그인과 Anonymous 로그인을 활성화합니다.
3. Authentication > Settings > Authorized domains에 GitHub Pages 도메인을 추가합니다.
   - 예: `사용자명.github.io`
4. Firestore Database를 생성합니다.
5. `firestore.rules` 내용을 Firebase Firestore Rules 탭에 붙여넣고 Publish 합니다.
6. `firebase-config.js`에 Firebase 웹앱 설정값을 입력합니다.
7. `firebase-config.js`의 `accessConfig.companyGmail`과 `adminEmails`를 실제 회사 공용 Gmail 주소로 교체합니다.
   - 예: `companyGmail: "company.account@gmail.com"`
   - 예: `adminEmails: ["company.account@gmail.com"]`
8. `firestore.rules`의 `company.shared@gmail.com`도 같은 실제 회사 공용 Gmail 주소로 교체합니다.

## GitHub Pages 배포

1. GitHub에서 새 repository를 만듭니다.
2. `ranpicker` 폴더 안의 파일을 모두 업로드합니다.
3. Repository > Settings > Pages로 이동합니다.
4. Source를 `Deploy from a branch`, Branch를 `main`, Folder를 `/root`로 선택합니다.
5. 저장 후 표시되는 GitHub Pages 주소로 접속합니다.

## 보안 주의

- GitHub Pages는 정적 파일 호스팅이므로 Firebase 설정값은 브라우저에 공개됩니다. 이는 Firebase의 일반적인 웹앱 구조이며, 실제 접근 제어는 Firestore Security Rules로 해야 합니다.
- `firestore.rules`의 `company.shared@gmail.com`은 반드시 실제 회사 공용 Gmail 주소로 바꾸세요. 이 작업을 하지 않으면 수정 권한이 의도대로 작동하지 않습니다.
- 직원 개인정보를 다루므로, 배포 전 Firebase Rules를 반드시 테스트하세요.

## 2026-05-29 수정 사항

- 이력관리 탭에서 저장 직후 결과가 바로 표시되도록 수정했습니다.
- 같은 조건(사업명, 평가일, 추출 인원 수, 최근참여 제외일수)으로 여러 번 저장하면 새 이력 문서를 추가하지 않고 기존 문서를 마지막 결과로 교체합니다.
- 기존 결과가 교체될 때 참여횟수와 최근참여일이 중복 증가하지 않도록 전체 이력 기준으로 다시 계산합니다.


## 이번 수정 사항

- Pool 데이터는 Firestore의 `employees` 컬렉션에 저장되며, 로그아웃 후 다시 로그인해도 계속 유지됩니다.
- Pool 데이터를 불러오는 과정은 `onSnapshot` 실시간 동기화로 변경했습니다.
- 랜덤 선정 버튼을 누르면 결과가 즉시 `projects` 컬렉션에 저장되어 이력관리 탭에 반영됩니다.
- 같은 조건(사업명, 평가일, 추출 인원 수, 최근참여 제외일수)으로 여러 번 선정하면 새 이력을 계속 추가하지 않고 같은 문서 ID에 덮어써서 마지막 결과만 남습니다.
- 같은 조건으로 다시 선정해도 참여횟수가 중복 누적되지 않도록 전체 이력 기준으로 Pool의 참여횟수/최근참여일을 다시 계산합니다.

주의: 이 기능이 정상적으로 작동하려면 Firebase 콘솔에서 Firestore Database가 생성되어 있어야 하고, `firestore.rules`를 배포해야 합니다.
