export interface TemplateTranslation {
  name: string;
  description: string;
  centerGoal: string;
  subjects: string[];
}

export interface MandalaTemplate {
  id: string;
  icon: string;
  category: 'productivity' | 'learning' | 'business' | 'personal';
  translations: Record<string, TemplateTranslation>;
}

export const mandalaTemplates: MandalaTemplate[] = [
  {
    id: "ai-ml-developer",
    icon: "\u{1F916}",
    category: "learning",
    translations: {
      en: {
        name: "AI/ML Developer",
        description: "Learning roadmap for AI and machine learning developers",
        centerGoal: "Become an AI/ML Expert",
        subjects: ["Math Foundations", "Python Mastery", "Machine Learning", "Deep Learning", "Data Engineering", "MLOps", "Paper Reading", "Projects"],
      },
      ko: {
        name: "AI/ML \uAC1C\uBC1C\uC790",
        description: "\uC778\uACF5\uC9C0\uB2A5 \uBC0F \uBA38\uC2E0\uB7EC\uB2DD \uAC1C\uBC1C\uC790\uB97C \uC704\uD55C \uD559\uC2B5 \uB85C\uB4DC\uB9F5",
        centerGoal: "AI/ML \uC804\uBB38\uAC00 \uB418\uAE30",
        subjects: ["\uC218\uD559 \uAE30\uCD08", "Python \uB9C8\uC2A4\uD130", "\uBA38\uC2E0\uB7EC\uB2DD", "\uB525\uB7EC\uB2DD", "\uB370\uC774\uD130 \uC5D4\uC9C0\uB2C8\uC5B4\uB9C1", "MLOps", "\uB17C\uBB38 \uC77D\uAE30", "\uD504\uB85C\uC81D\uD2B8"],
      },
    },
  },
  {
    id: "ux-designer",
    icon: "\u{1F3A8}",
    category: "learning",
    translations: {
      en: {
        name: "UX Designer",
        description: "Growth roadmap for user experience designers",
        centerGoal: "Grow as a UX Designer",
        subjects: ["User Research", "UI Design", "Prototyping", "Design Systems", "Accessibility", "Portfolio", "Communication", "Trend Analysis"],
      },
      ko: {
        name: "UX \uB514\uC790\uC774\uB108",
        description: "\uC0AC\uC6A9\uC790 \uACBD\uD5D8 \uB514\uC790\uC774\uB108\uB97C \uC704\uD55C \uC131\uC7A5 \uB85C\uB4DC\uB9F5",
        centerGoal: "UX \uB514\uC790\uC774\uB108 \uC131\uC7A5",
        subjects: ["\uC0AC\uC6A9\uC790 \uB9AC\uC11C\uCE58", "UI \uB514\uC790\uC778", "\uD504\uB85C\uD1A0\uD0C0\uC774\uD551", "\uB514\uC790\uC778 \uC2DC\uC2A4\uD15C", "\uC811\uADFC\uC131", "\uD3EC\uD2B8\uD3F4\uB9AC\uC624", "\uCEE4\uBBA4\uB2C8\uCF00\uC774\uC158", "\uD2B8\uB80C\uB4DC \uBD84\uC11D"],
      },
    },
  },
  {
    id: "freelancer",
    icon: "\u{1F4BC}",
    category: "business",
    translations: {
      en: {
        name: "Freelancer / Solopreneur",
        description: "Mandala for running an independent business",
        centerGoal: "Successful Solo Business",
        subjects: ["Expertise", "Marketing", "Client Management", "Finance", "Time Management", "Networking", "Legal / Tax", "Self-Development"],
      },
      ko: {
        name: "\uD504\uB9AC\uB79C\uC11C/1\uC778\uAE30\uC5C5\uAC00",
        description: "\uB3C5\uB9BD\uC801\uC778 \uBE44\uC988\uB2C8\uC2A4 \uC6B4\uC601\uC744 \uC704\uD55C \uB9CC\uB2E4\uB77C\uD2B8",
        centerGoal: "\uC131\uACF5\uC801\uC778 1\uC778 \uAE30\uC5C5",
        subjects: ["\uC804\uBB38\uC131 \uAC15\uD654", "\uB9C8\uCF00\uD305", "\uACE0\uAC1D \uAD00\uB9AC", "\uC7AC\uBB34 \uAD00\uB9AC", "\uC2DC\uAC04 \uAD00\uB9AC", "\uB124\uD2B8\uC6CC\uD0B9", "\uBC95\uB960/\uC138\uAE08", "\uC790\uAE30\uACC4\uBC1C"],
      },
    },
  },
  {
    id: "job-seeker",
    icon: "\u{1F3AF}",
    category: "personal",
    translations: {
      en: {
        name: "Job Seeker",
        description: "Mandala for systematic job preparation",
        centerGoal: "Land the Job",
        subjects: ["Self-Analysis", "Resume / Cover Letter", "Interview Prep", "Job Skills", "Company Research", "Portfolio", "Networking", "Mental Health"],
      },
      ko: {
        name: "\uCDE8\uC5C5 \uC900\uBE44\uC0DD",
        description: "\uCCB4\uACC4\uC801\uC778 \uCDE8\uC5C5 \uC900\uBE44\uB97C \uC704\uD55C \uB9CC\uB2E4\uB77C\uD2B8",
        centerGoal: "\uCDE8\uC5C5 \uC131\uACF5",
        subjects: ["\uC790\uAE30\uBD84\uC11D", "\uC774\uB825\uC11C/\uC790\uC18C\uC11C", "\uBA74\uC811 \uC900\uBE44", "\uC9C1\uBB34 \uC5ED\uB7C9", "\uAE30\uC5C5 \uBD84\uC11D", "\uD3EC\uD2B8\uD3F4\uB9AC\uC624", "\uC778\uB9E5 \uAD6C\uCD95", "\uBA58\uD0C8 \uAD00\uB9AC"],
      },
    },
  },
  {
    id: "content-creator",
    icon: "\u{1F4F9}",
    category: "business",
    translations: {
      en: {
        name: "Content Creator",
        description: "Growth mandala for YouTubers and bloggers",
        centerGoal: "Influential Creator",
        subjects: ["Content Planning", "Filming / Editing", "Channel Branding", "Community", "Monetization", "Collaborations", "Trend Analysis", "Self-Care"],
      },
      ko: {
        name: "\uCF58\uD150\uCE20 \uD06C\uB9AC\uC5D0\uC774\uD130",
        description: "\uC720\uD29C\uBC84/\uBE14\uB85C\uAC70\uB97C \uC704\uD55C \uC131\uC7A5 \uB9CC\uB2E4\uB77C\uD2B8",
        centerGoal: "\uC601\uD5A5\uB825 \uC788\uB294 \uD06C\uB9AC\uC5D0\uC774\uD130",
        subjects: ["\uCF58\uD150\uCE20 \uAE30\uD68D", "\uCD2C\uC601/\uD3B8\uC9D1", "\uCC44\uB110 \uBE0C\uB79C\uB529", "\uCEE4\uBBA4\uB2C8\uD2F0", "\uC218\uC775\uD654", "\uD611\uC5C5/\uD611\uCC2C", "\uD2B8\uB80C\uB4DC \uBD84\uC11D", "\uC790\uAE30\uAD00\uB9AC"],
      },
    },
  },
  {
    id: "student",
    icon: "\u{1F4DA}",
    category: "learning",
    translations: {
      en: {
        name: "Student",
        description: "Mandala for efficient studying",
        centerGoal: "Academic Achievement",
        subjects: ["Major Studies", "Exam Prep", "Time Management", "Health", "Extracurriculars", "Language Skills", "Career Exploration", "Relationships"],
      },
      ko: {
        name: "\uB300\uD559\uC0DD/\uC218\uD5D8\uC0DD",
        description: "\uD6A8\uC728\uC801\uC778 \uD559\uC2B5\uC744 \uC704\uD55C \uB9CC\uB2E4\uB77C\uD2B8",
        centerGoal: "\uD559\uC5C5 \uC131\uCDE8",
        subjects: ["\uC804\uACF5 \uD559\uC2B5", "\uC2DC\uD5D8 \uC900\uBE44", "\uC2DC\uAC04 \uAD00\uB9AC", "\uAC74\uAC15 \uAD00\uB9AC", "\uB300\uC678\uD65C\uB3D9", "\uC5B4\uD559 \uB2A5\uB825", "\uC9C4\uB85C \uD0D0\uC0C9", "\uC778\uAC04\uAD00\uACC4"],
      },
    },
  },
];

export { mandalaTemplates as MANDALA_TEMPLATES };

/** Get translation for current language, fallback to 'en' */
export function getTemplateTranslation(
  template: MandalaTemplate,
  lang: string,
): TemplateTranslation {
  return template.translations[lang] ?? template.translations.en;
}
