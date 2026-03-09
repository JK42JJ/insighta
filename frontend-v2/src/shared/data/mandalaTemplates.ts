export interface MandalaTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  centerGoal: string;
  subjects: string[];
  category?: 'productivity' | 'learning' | 'business' | 'personal';
}

export { mandalaTemplates as MANDALA_TEMPLATES };

export const mandalaTemplates: MandalaTemplate[] = [
  {
    id: "ai-ml-developer",
    name: "AI/ML 개발자",
    description: "인공지능 및 머신러닝 개발자를 위한 학습 로드맵",
    icon: "🤖",
    centerGoal: "AI/ML 전문가 되기",
    subjects: [
      "수학 기초",
      "Python 마스터",
      "머신러닝",
      "딥러닝",
      "데이터 엔지니어링",
      "MLOps",
      "논문 읽기",
      "프로젝트",
    ],
  },
  {
    id: "ux-designer",
    name: "UX 디자이너",
    description: "사용자 경험 디자이너를 위한 성장 로드맵",
    icon: "🎨",
    centerGoal: "UX 디자이너 성장",
    subjects: [
      "사용자 리서치",
      "UI 디자인",
      "프로토타이핑",
      "디자인 시스템",
      "접근성",
      "포트폴리오",
      "커뮤니케이션",
      "트렌드 분석",
    ],
  },
  {
    id: "freelancer",
    name: "프리랜서/1인기업가",
    description: "독립적인 비즈니스 운영을 위한 만다라트",
    icon: "💼",
    centerGoal: "성공적인 1인 기업",
    subjects: [
      "전문성 강화",
      "마케팅",
      "고객 관리",
      "재무 관리",
      "시간 관리",
      "네트워킹",
      "법률/세금",
      "자기계발",
    ],
  },
  {
    id: "job-seeker",
    name: "취업 준비생",
    description: "체계적인 취업 준비를 위한 만다라트",
    icon: "🎯",
    centerGoal: "취업 성공",
    subjects: [
      "자기분석",
      "이력서/자소서",
      "면접 준비",
      "직무 역량",
      "기업 분석",
      "포트폴리오",
      "인맥 구축",
      "멘탈 관리",
    ],
  },
  {
    id: "content-creator",
    name: "콘텐츠 크리에이터",
    description: "유튜버/블로거를 위한 성장 만다라트",
    icon: "📹",
    centerGoal: "영향력 있는 크리에이터",
    subjects: [
      "콘텐츠 기획",
      "촬영/편집",
      "채널 브랜딩",
      "커뮤니티",
      "수익화",
      "협업/협찬",
      "트렌드 분석",
      "자기관리",
    ],
  },
  {
    id: "student",
    name: "대학생/수험생",
    description: "효율적인 학습을 위한 만다라트",
    icon: "📚",
    centerGoal: "학업 성취",
    subjects: [
      "전공 학습",
      "시험 준비",
      "시간 관리",
      "건강 관리",
      "대외활동",
      "어학 능력",
      "진로 탐색",
      "인간관계",
    ],
  },
];
