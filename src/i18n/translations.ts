import type {
  ExecutionRoute,
  LanguageCode,
  LocalAvailabilityState,
  PrivacyMode,
} from '../engine/types';

export interface Translations {
  brand: string;
  nav: {
    assistant: string;
    privacy: string;
    intelligence: string;
    settings: string;
    overview: string;
  };
  common: {
    active: string;
    select: string;
    checking: string;
    probing: string;
    online: string;
    offline: string;
    available: string;
    unavailable: string;
    yes: string;
    no: string;
    dismiss: string;
    selected: string;
    eligible: string;
    excluded: string;
    signInErrorPrefix: string;
    notAvailableAbbr: string;
  };
  availability: Record<LocalAvailabilityState, string>;
  auth: {
    signIn: string;
    signOut: string;
    signingIn: string;
    signedInAs: string;
    guestMode: string;
    verified: string;
    unverified: string;
    authenticatedUser: string;
  };
  routes: Record<ExecutionRoute, string>;
  privacyModes: Record<
    PrivacyMode,
    {
      title: string;
      subtitle: string;
      rule: string;
    }
  >;
  onboarding: {
    kicker: string;
    headline: string;
    subheadline: string;
    ctaStart: string;
    ctaLearnPrivacy: string;
    chooseLanguage: string;
    choosePrivacy: string;
    principles: Array<{ title: string; body: string }>;
  };
  assistant: {
    newChat: string;
    historyTitle: string;
    noHistory: string;
    placeholder: string;
    send: string;
    sending: string;
    attachFile: string;
    attachmentHint: string;
    emptyTitle: string;
    emptySubtitle: string;
    starterPrompts: string[];
    inspectExecution: string;
    blockedTitle: string;
    executionErrorTitle: string;
    switchBalanced: string;
    deleteChat: string;
    localOnlyBadge: string;
    cloudNotice: string;
    persistenceOff: string;
    persistenceOn: string;
    privacyModeLabel: string;
    onDeviceModelLabel: string;
    networkLabel: string;
    msgsSuffix: string;
    localReady: string;
    localUnavailable: string;
    cloudReady: string;
    cloudOffline: string;
    cloudSignInRequired: string;
    cloudSignInBanner: string;
  };
  executionDetails: {
    title: string;
    close: string;
    selectedRoute: string;
    rationale: string;
    privacyStatus: string;
    modelUsed: string;
    estimatedLatency: string;
    actualLatency: string;
    estimatedCost: string;
    tokens: string;
    stepsTitle: string;
    constraintsTitle: string;
    scoringTitle: string;
    limitationsTitle: string;
    noSelection: string;
    localLocality: string;
    cloudLocality: string;
    redactedCountLabel: string;
    colRoute: string;
    colScore: string;
    colEstMs: string;
    colStatus: string;
  };
  privacyCenter: {
    title: string;
    subtitle: string;
    modeHeading: string;
    customHeading: string;
    activateCustomMode: string;
    allowCloudFallback: string;
    redactPiiBeforeCloud: string;
    preferLocalForSimpleTasks: string;
    blockAttachmentsInCloud: string;
    maxCloudPayloadKb: string;
    maxEstimatedCostUsd: string;
    simulatorTitle: string;
    simulatorSubtitle: string;
    simulatorPlaceholder: string;
    simulatorRun: string;
    simulatorResultRoute: string;
  };
  intelligence: {
    title: string;
    subtitle: string;
    refreshProbes: string;
    localModelLabel: string;
    cloudApiLabel: string;
    networkLabel: string;
    hardwareLabel: string;
    inspectingPromptApi: string;
    serverEndpointReady: string;
    serverEndpointAuthNeeded: string;
    serverEndpointUnavailable: string;
    checkingConnection: string;
    ramLabel: string;
    coresLabel: string;
    webGpuLabel: string;
    netTypeLabel: string;
    netRttLabel: string;
    downloadLocalBtn: string;
    downloadingLabel: string;
    metricsTitle: string;
    totalRuns: string;
    avgLatency: string;
    totalCost: string;
    localShare: string;
    historyTitle: string;
    emptyHistoryTitle: string;
    emptyHistoryBody: string;
    goToAssistant: string;
    filterAll: string;
    colTime: string;
    colTask: string;
    colRoute: string;
    colModel: string;
    colLatency: string;
    colCost: string;
    colStatus: string;
    benchmarkTitle: string;
    benchmarkSubtitle: string;
    benchmarkScopeLocal: string;
    benchmarkScopeFull: string;
    benchmarkRunBtn: string;
    benchmarkRunning: string;
    benchmarkCopyJson: string;
    benchmarkCopied: string;
    benchmarkColdStart: string;
    benchmarkWarmMean: string;
    benchmarkSuccessRate: string;
    benchmarkHeapDelta: string;
    benchmarkDisclaimer: string;
  };
  settings: {
    title: string;
    subtitle: string;
    languageTitle: string;
    languageDesc: string;
    storageTitle: string;
    persistLabel: string;
    persistDesc: string;
    clearSessionBtn: string;
    clearCloudBtn: string;
    accountTitle: string;
    diagnosticsTitle: string;
    firebaseProjectLabel: string;
    firestoreStatusLabel: string;
    appCheckLabel: string;
    appCheckProviderLabel: string;
    cloudBackendLabel: string;
    mobileReadinessTitle: string;
    mobileReadinessBody: string;
  };
}

export const TRANSLATIONS: Record<LanguageCode, Translations> = {
  en: {
    brand: 'ORBIT AI',
    nav: {
      assistant: 'Assistant',
      privacy: 'Privacy',
      intelligence: 'Intelligence',
      settings: 'Settings',
      overview: 'Overview',
    },
    common: {
      active: 'Active',
      select: 'Select',
      checking: 'Checking',
      probing: 'Probing',
      online: 'Online',
      offline: 'Offline',
      available: 'Available',
      unavailable: 'Unavailable',
      yes: 'Yes',
      no: 'No',
      dismiss: 'Dismiss',
      selected: 'Selected',
      eligible: 'Eligible',
      excluded: 'Excluded',
      signInErrorPrefix: 'Sign-in error:',
      notAvailableAbbr: 'n/a',
    },
    availability: {
      available: 'Available',
      downloadable: 'Downloadable',
      downloading: 'Downloading',
      unavailable: 'Unavailable',
    },
    auth: {
      signIn: 'Sign in with Google',
      signOut: 'Sign out',
      signingIn: 'Signing in...',
      signedInAs: 'Signed in as',
      guestMode: 'Local session (Sign in to sync & unlock Cloud Gemini)',
      verified: 'Verified',
      unverified: 'Unverified',
      authenticatedUser: 'Authenticated User',
    },
    routes: {
      LOCAL: 'Local',
      CLOUD: 'Cloud',
      HYBRID: 'Hybrid',
      BLOCKED: 'Blocked',
    },
    privacyModes: {
      STRICT_LOCAL: {
        title: 'Strict Local',
        subtitle: 'Zero cloud transmission under any circumstance.',
        rule: 'Never sends task content to cloud models. Blocks execution with an explanation if on-device inference is unavailable.',
      },
      BALANCED: {
        title: 'Balanced',
        subtitle: 'Prefer local when suitable; protect sensitive data in hybrid.',
        rule: 'Runs eligible tasks locally, redacts detected PII locally before cloud reasoning, and falls back to cloud only when needed.',
      },
      FLEXIBLE: {
        title: 'Flexible',
        subtitle: 'Optimize for capability, latency, and quality across routes.',
        rule: 'Selects the highest-scoring route across local, hybrid, and cloud models while still flagging high-risk secrets.',
      },
      CUSTOM: {
        title: 'Custom',
        subtitle: 'Enforce explicit payload, attachment, PII, and cost rules.',
        rule: 'Evaluates your exact thresholds before scoring routes.',
      },
    },
    onboarding: {
      kicker: 'ORBIT Adaptive Intelligence Engine',
      headline: 'One intelligent assistant. Every device. Always the right execution strategy.',
      subheadline:
        'ORBIT AI analyzes every task against your device capabilities, network state, cost limits, and privacy rules before deciding whether to execute locally, in the cloud, or via a privacy-preserving hybrid plan.',
      ctaStart: 'Open Assistant',
      ctaLearnPrivacy: 'Configure Privacy',
      chooseLanguage: 'Interface Language',
      choosePrivacy: 'Starting Privacy Posture',
      principles: [
        {
          title: 'Honest Local Execution',
          body: 'Probes Chrome Prompt API availability directly. Never simulates local execution with hidden cloud calls.',
        },
        {
          title: 'Verifiable Hybrid Decomposition',
          body: 'Analyzes tasks and redacts sensitive entities locally on-device before sending scoped reasoning payloads to Gemini.',
        },
        {
          title: 'Deterministic Policy Gates',
          body: 'Privacy rules and hard constraints run before route scoring. Strict Local never falls back silently to the cloud.',
        },
      ],
    },
    assistant: {
      newChat: 'New Chat',
      historyTitle: 'Conversations',
      noHistory: 'No saved conversations yet.',
      placeholder: 'Ask ORBIT AI anything… (Shift+Enter for new line)',
      send: 'Send',
      sending: 'Routing & executing…',
      attachFile: 'Attach text/code file',
      attachmentHint: 'Supports .txt, .md, .json, .csv, .ts, .js, .py up to 128 KB',
      emptyTitle: 'Ready to route your next task',
      emptySubtitle:
        'Each prompt is analyzed locally for complexity, sensitive data, device readiness, and cost before execution.',
      starterPrompts: [
        'Summarize the trade-offs between edge inference and cloud LLMs.',
        'Review this draft for user ali@example.com with API key sk-test1234567890abcdef.',
        'Design a clean TypeScript retry utility with exponential backoff.',
      ],
      inspectExecution: 'Inspect execution',
      blockedTitle: 'Execution blocked by policy',
      executionErrorTitle: 'Execution Error',
      switchBalanced: 'Switch to Balanced mode',
      deleteChat: 'Delete conversation',
      localOnlyBadge: 'On-device only',
      cloudNotice: 'Cloud execution uses authenticated Gemini',
      persistenceOff: 'Ephemeral session (not saved to Firestore)',
      persistenceOn: 'Synced to your Firestore account',
      privacyModeLabel: 'Privacy Mode',
      onDeviceModelLabel: 'On-Device Model',
      networkLabel: 'Network',
      msgsSuffix: 'msgs',
      localReady: 'Local Ready',
      localUnavailable: 'Local Unavailable',
      cloudReady: 'Cloud Ready',
      cloudOffline: 'Cloud Offline',
      cloudSignInRequired: 'Sign-in Required for Cloud',
      cloudSignInBanner: 'Sign in with Google to authorize Cloud and Hybrid Gemini execution. Local on-device tasks remain available offline.',
    },
    executionDetails: {
      title: 'Execution Transparency Report',
      close: 'Close',
      selectedRoute: 'Selected Route',
      rationale: 'Decision Rationale',
      privacyStatus: 'Privacy Status',
      modelUsed: 'Model Used',
      estimatedLatency: 'Estimated Latency',
      actualLatency: 'Measured Latency',
      estimatedCost: 'Estimated Cost',
      tokens: 'Tokens (In / Out)',
      stepsTitle: 'Execution Plan Trace',
      constraintsTitle: 'Constraint Gates',
      scoringTitle: 'Route Score Comparison',
      limitationsTitle: 'Honest Limitations',
      noSelection: 'Select any assistant response to inspect how OAIE routed and executed it.',
      localLocality: 'On-Device',
      cloudLocality: 'Cloud',
      redactedCountLabel: 'Sensitive items redacted locally',
      colRoute: 'Route',
      colScore: 'Score',
      colEstMs: 'Est. ms',
      colStatus: 'Status',
    },
    privacyCenter: {
      title: 'Privacy Center',
      subtitle:
        'Configure hard constraints enforced by the Privacy Guardian before any model routing score is computed.',
      modeHeading: 'Execution Privacy Modes',
      customHeading: 'Custom Policy Parameters',
      activateCustomMode: 'Activate Custom Mode',
      allowCloudFallback: 'Allow cloud fallback when local model is unavailable',
      redactPiiBeforeCloud: 'Redact detected PII/secrets locally before cloud inference',
      preferLocalForSimpleTasks: 'Prefer on-device execution for simple tasks',
      blockAttachmentsInCloud: 'Block sending file attachments to cloud models',
      maxCloudPayloadKb: 'Max cloud payload size (KB)',
      maxEstimatedCostUsd: 'Max estimated cost per request (USD)',
      simulatorTitle: 'Live Route Simulator',
      simulatorSubtitle:
        'Test how OAIE classifies and routes a sample prompt under your current environment without sending any request.',
      simulatorPlaceholder: 'Enter a test prompt (e.g. include an email or complex coding request)…',
      simulatorRun: 'Simulate Routing',
      simulatorResultRoute: 'Projected Route',
    },
    intelligence: {
      title: 'Intelligence Dashboard',
      subtitle:
        'Live device, model, and network probes paired strictly with real measured execution telemetry.',
      refreshProbes: 'Refresh Probes',
      localModelLabel: 'Local On-Device Model',
      cloudApiLabel: 'Cloud Gemini Endpoint',
      networkLabel: 'Network Telemetry',
      hardwareLabel: 'Device Hardware',
      inspectingPromptApi: 'Inspecting browser Prompt API…',
      serverEndpointReady: 'Authenticated cloud endpoint responsive',
      serverEndpointAuthNeeded: 'Cloud endpoint online — Google Sign-In required to authorize execution.',
      serverEndpointUnavailable: 'Cloud inference backend unreachable or not configured.',
      checkingConnection: 'Checking navigator.connection…',
      ramLabel: 'RAM',
      coresLabel: 'Cores',
      webGpuLabel: 'WebGPU',
      netTypeLabel: 'Type',
      netRttLabel: 'RTT',
      downloadLocalBtn: 'Download Local Model',
      downloadingLabel: 'Downloading model…',
      metricsTitle: 'Measured Session Telemetry',
      totalRuns: 'Total Executions',
      avgLatency: 'Mean Measured Latency',
      totalCost: 'Estimated Cloud Cost',
      localShare: 'Local / Hybrid Share',
      historyTitle: 'Execution History',
      emptyHistoryTitle: 'No executions recorded yet',
      emptyHistoryBody:
        'ORBIT AI never displays synthetic statistics. Run a prompt in the Assistant to record real latency, token, and cost measurements.',
      goToAssistant: 'Open Assistant',
      filterAll: 'All Routes',
      colTime: 'Time',
      colTask: 'Task Type',
      colRoute: 'Route',
      colModel: 'Model',
      colLatency: 'Measured',
      colCost: 'Est. Cost',
      colStatus: 'Status',
      benchmarkTitle: 'Live Browser Benchmark Suite (8 Representative Tasks)',
      benchmarkSubtitle:
        'Measure real on-device Chrome Prompt API latency (cold-start vs. warm), authenticated Cloud Gemini responses, and Hybrid PII sanitization directly in this browser.',
      benchmarkScopeLocal: 'Local Only (0 Cloud Calls)',
      benchmarkScopeFull: 'Full 8-Task Comparison (LOCAL / CLOUD / HYBRID)',
      benchmarkRunBtn: 'Run Live Benchmark',
      benchmarkRunning: 'Running benchmark…',
      benchmarkCopyJson: 'Copy JSON Report',
      benchmarkCopied: 'Copied',
      benchmarkColdStart: 'Local Cold Start',
      benchmarkWarmMean: 'Local Warm Mean',
      benchmarkSuccessRate: 'Completion Rate',
      benchmarkHeapDelta: 'Heap Δ',
      benchmarkDisclaimer:
        'Strictly executes real browser and authenticated server APIs. If Chrome Prompt API or Google Sign-In is unavailable, affected routes block cleanly.',
    },
    settings: {
      title: 'Settings & Diagnostics',
      subtitle: 'Manage interface language, conversation storage consent, authentication, and Firebase status.',
      languageTitle: 'Language & Direction',
      languageDesc: 'Switch between English (LTR) and Arabic (RTL).',
      storageTitle: 'Conversation Data Control',
      persistLabel: 'Save conversations to Cloud Firestore',
      persistDesc:
        'When disabled, conversation content stays strictly in browser memory for the active session. Execution telemetry excludes prompt content.',
      clearSessionBtn: 'Clear Local Session History',
      clearCloudBtn: 'Clear Cloud Telemetry',
      accountTitle: 'Firebase Account',
      diagnosticsTitle: 'Environment & Deployment Diagnostics',
      firebaseProjectLabel: 'Firebase Project',
      firestoreStatusLabel: 'Firestore Connection',
      appCheckLabel: 'Firebase App Check',
      appCheckProviderLabel: 'Provider',
      cloudBackendLabel: 'Active Cloud Path',
      mobileReadinessTitle: 'Supported Local Inference & Mobile Readiness',
      mobileReadinessBody:
        'On Web, on-device local inference requires Desktop Chrome 138+ with Chrome Built-in Prompt API (Gemini Nano). Safari, Firefox, iOS WebKit, and headless browsers do not expose LanguageModel. OAIE (src/engine/) has zero DOM dependencies: Android requires Android 14+ with Firebase AI Logic + ML Kit AICore, and Expo requires a custom native build (expo-dev-client).',
    },
  },
  ar: {
    brand: 'ORBIT AI',
    nav: {
      assistant: 'المساعد',
      privacy: 'الخصوصية',
      intelligence: 'لوحة الذكاء',
      settings: 'الإعدادات',
      overview: 'نظرة عامة',
    },
    common: {
      active: 'نشط',
      select: 'اختيار',
      checking: 'جارٍ الفحص',
      probing: 'جارٍ الفحص',
      online: 'متصل',
      offline: 'غير متصل',
      available: 'متاح',
      unavailable: 'غير متاح',
      yes: 'نعم',
      no: 'لا',
      dismiss: 'إغلاق',
      selected: 'مختار',
      eligible: 'مؤهّل',
      excluded: 'مستبعد',
      signInErrorPrefix: 'خطأ في تسجيل الدخول:',
      notAvailableAbbr: 'غير متوفر',
    },
    availability: {
      available: 'متاح',
      downloadable: 'قابل للتنزيل',
      downloading: 'جارٍ التنزيل',
      unavailable: 'غير متاح',
    },
    auth: {
      signIn: 'تسجيل الدخول عبر Google',
      signOut: 'تسجيل الخروج',
      signingIn: 'جارٍ تسجيل الدخول…',
      signedInAs: 'مسجل الدخول باسم',
      guestMode: 'جلسة محلية (سجّل الدخول للمزامنة وتفعيل Gemini السحابي)',
      verified: 'موثّق',
      unverified: 'غير موثّق',
      authenticatedUser: 'مستخدم مصادق عليه',
    },
    routes: {
      LOCAL: 'محلي',
      CLOUD: 'سحابي',
      HYBRID: 'هجين',
      BLOCKED: 'محظور',
    },
    privacyModes: {
      STRICT_LOCAL: {
        title: 'محلي صارم',
        subtitle: 'يمنع الإرسال السحابي نهائياً تحت أي ظرف.',
        rule: 'لا يرسل محتوى المهام إلى السحابة أبداً. يوقف التنفيذ مع توضيح السبب إذا كان النموذج المحلي غير متاح.',
      },
      BALANCED: {
        title: 'متوازن',
        subtitle: 'يفضّل المعالجة المحلية، وينقّح البيانات الحساسة في الوضع الهجين.',
        rule: 'ينفّذ المهام المناسبة محلياً، ويحجب البيانات الحساسة محلياً قبل أي معالجة سحابية.',
      },
      FLEXIBLE: {
        title: 'مرن',
        subtitle: 'يوازن بين القدرة وزمن الاستجابة وجودة النتائج.',
        rule: 'يختار المسار الأعلى تقييماً بين المحلي والهجين والسحابي مع تنبيه البيانات الحساسة.',
      },
      CUSTOM: {
        title: 'مخصّص',
        subtitle: 'تطبيق حدود مخصصة للحجم والمرفقات والتكلفة والبيانات الحساسة.',
        rule: 'يفحص حدودك المخصصة كقيود صارمة قبل حساب نقاط المسارات.',
      },
    },
    onboarding: {
      kicker: 'محرك الذكاء التكيّفي ORBIT',
      headline: 'مساعد ذكي واحد. لكل جهاز. دائماً باستراتيجية التنفيذ الأنسب.',
      subheadline:
        'يحلّل ORBIT AI كل مهمة وفق قدرات جهازك وحالة الشبكة وحدود التكلفة وقواعد الخصوصية قبل اختيار التنفيذ المحلي أو السحابي أو الهجين.',
      ctaStart: 'فتح المساعد',
      ctaLearnPrivacy: 'ضبط الخصوصية',
      chooseLanguage: 'لغة الواجهة',
      choosePrivacy: 'وضع الخصوصية المبدئي',
      principles: [
        {
          title: 'تنفيذ محلي صادق',
          body: 'يفحص توفر Chrome Prompt API فعلياً ولا يحاكي التشغيل المحلي بطلبات سحابية مخفية.',
        },
        {
          title: 'تفكيك هجين قابل للتحقق',
          body: 'يحلّل المهمة وينقّح العناصر الحساسة محلياً على جهازك قبل إرسال النص المنقّح إلى Gemini.',
        },
        {
          title: 'قيود خصوصية حتمية',
          body: 'تُطبّق قواعد الخصوصية قبل التقييم؛ والوضع المحلي الصارم لا يتحوّل صمتاً إلى السحابة.',
        },
      ],
    },
    assistant: {
      newChat: 'محادثة جديدة',
      historyTitle: 'المحادثات',
      noHistory: 'لا توجد محادثات محفوظة بعد.',
      placeholder: 'اسأل ORBIT AI أي شيء… (Shift+Enter لسطر جديد)',
      send: 'إرسال',
      sending: 'جارٍ التوجيه والتنفيذ…',
      attachFile: 'إرفاق ملف نصي/برمجي',
      attachmentHint: 'يدعم ملفات .txt, .md, .json, .csv, .ts, .js, .py حتى 128 كيلوبايت',
      emptyTitle: 'جاهز لتوجيه مهمتك التالية',
      emptySubtitle:
        'يتم تحليل كل طلب محلياً من حيث التعقيد والبيانات الحساسة وجاهزية الجهاز والتكلفة قبل التنفيذ.',
      starterPrompts: [
        'لخّص الفروق العملية بين الذكاء المحلي على الجهاز والنماذج السحابية.',
        'راجع هذا النص للمستخدم ali@example.com مع المفتاح sk-test1234567890abcdef.',
        'صمّم دالة TypeScript لإعادة المحاولة مع تأخير أسي.',
      ],
      inspectExecution: 'فحص تفاصيل التنفيذ',
      blockedTitle: 'تم إيقاف التنفيذ التزاماً بالسياسة',
      executionErrorTitle: 'خطأ في التنفيذ',
      switchBalanced: 'التبديل إلى الوضع المتوازن',
      deleteChat: 'حذف المحادثة',
      localOnlyBadge: 'على الجهاز فقط',
      cloudNotice: 'التنفيذ السحابي يستخدم Gemini الموثّق',
      persistenceOff: 'جلسة مؤقتة (غير محفوظة في Firestore)',
      persistenceOn: 'متزامنة مع حسابك في Firestore',
      privacyModeLabel: 'وضع الخصوصية',
      onDeviceModelLabel: 'النموذج المحلي',
      networkLabel: 'الشبكة',
      msgsSuffix: 'رسائل',
      localReady: 'المحلي جاهز',
      localUnavailable: 'المحلي غير متاح',
      cloudReady: 'السحابة جاهزة',
      cloudOffline: 'السحابة غير متاحة',
      cloudSignInRequired: 'تسجيل الدخول مطلوب للسحابة',
      cloudSignInBanner: 'سجّل الدخول بحساب Google لتفويض التنفيذ السحابي والهجين عبر Gemini. تبقى المهام المحلية متاحة دون إنترنت.',
    },
    executionDetails: {
      title: 'تقرير شفافية التنفيذ',
      close: 'إغلاق',
      selectedRoute: 'المسار المختار',
      rationale: 'سبب الاختيار',
      privacyStatus: 'حالة الخصوصية',
      modelUsed: 'النموذج المستخدم',
      estimatedLatency: 'الزمن المقدّر',
      actualLatency: 'الزمن المقاس فعلياً',
      estimatedCost: 'التكلفة المقدّرة',
      tokens: 'الرموز (إدخال / إخراج)',
      stepsTitle: 'مسار خطوات التنفيذ',
      constraintsTitle: 'بوابات القيود',
      scoringTitle: 'مقارنة نقاط المسارات',
      limitationsTitle: 'القيود والملاحظات',
      noSelection: 'اختر أي رد من المساعد لعرض تفاصيل توجيه المحرك وتنفيذه.',
      localLocality: 'محلي على الجهاز',
      cloudLocality: 'سحابي',
      redactedCountLabel: 'عناصر حساسة نُقّحت محلياً',
      colRoute: 'المسار',
      colScore: 'النقاط',
      colEstMs: 'الزمن المقدّر',
      colStatus: 'الحالة',
    },
    privacyCenter: {
      title: 'مركز الخصوصية',
      subtitle:
        'اضبط القيود الصارمة التي يفرضها حارس الخصوصية قبل حساب نقاط أي مسار تنفيذ.',
      modeHeading: 'أوضاع خصوصية التنفيذ',
      customHeading: 'إعدادات السياسة المخصصة',
      activateCustomMode: 'تفعيل الوضع المخصّص',
      allowCloudFallback: 'السماح بالانتقال للسحابة عند غياب النموذج المحلي',
      redactPiiBeforeCloud: 'تنقيح البيانات الحساسة محلياً قبل الإرسال للسحابة',
      preferLocalForSimpleTasks: 'تفضيل التشغيل المحلي للمهام البسيطة',
      blockAttachmentsInCloud: 'منع إرسال المرفقات إلى النماذج السحابية',
      maxCloudPayloadKb: 'الحد الأقصى لحمولة السحابة (كيلوبايت)',
      maxEstimatedCostUsd: 'الحد الأقصى للتكلفة المقدّرة لكل طلب (دولار)',
      simulatorTitle: 'محاكي التوجيه المباشر',
      simulatorSubtitle:
        'اختبر كيف يصنّف المحرك ويوجه طلباً تجريبياً ضمن بيئتك الحالية دون إرسال أي بيانات.',
      simulatorPlaceholder: 'أدخل نصاً تجريبياً (مثل بريد إلكتروني أو سؤال برمجي)…',
      simulatorRun: 'محاكاة التوجيه',
      simulatorResultRoute: 'المسار المتوقع',
    },
    intelligence: {
      title: 'لوحة الذكاء والقياس',
      subtitle:
        'فحوصات حية للجهاز والنماذج والشبكة مقترنة فقط بقياسات التنفيذ الفعلية.',
      refreshProbes: 'تحديث الفحوصات',
      localModelLabel: 'النموذج المحلي على الجهاز',
      cloudApiLabel: 'نقطة Gemini السحابية',
      networkLabel: 'حالة الشبكة',
      hardwareLabel: 'عتاد الجهاز',
      inspectingPromptApi: 'جارٍ فحص واجهة Prompt API في المتصفح…',
      serverEndpointReady: 'نقطة النهاية السحابية الموثّقة متصلة وتستجيب',
      serverEndpointAuthNeeded: 'الخادم السحابي متصل — سجّل الدخول عبر Google لتوثيق الطلبات.',
      serverEndpointUnavailable: 'الخدمة السحابية غير متاحة أو غير مهيأة حالياً.',
      checkingConnection: 'جارٍ فحص حالة الاتصال…',
      ramLabel: 'الذاكرة',
      coresLabel: 'الأنوية',
      webGpuLabel: 'WebGPU',
      netTypeLabel: 'النوع',
      netRttLabel: 'زمن الذهاب والإياب',
      downloadLocalBtn: 'تنزيل النموذج المحلي',
      downloadingLabel: 'جارٍ التنزيل…',
      metricsTitle: 'قياسات الجلسة الفعلية',
      totalRuns: 'إجمالي التنفيذات',
      avgLatency: 'متوسط الزمن المقاس',
      totalCost: 'التكلفة السحابية المقدّرة',
      localShare: 'نسبة المحلي / الهجين',
      historyTitle: 'سجل التنفيذ',
      emptyHistoryTitle: 'لا توجد عمليات تنفيذ مسجلة بعد',
      emptyHistoryBody:
        'لا يعرض ORBIT AI إحصاءات وهمية. أرسل مهمة في المساعد لتسجيل قياسات الزمن والرموز والتكلفة الفعلية.',
      goToAssistant: 'فتح المساعد',
      filterAll: 'جميع المسارات',
      colTime: 'الوقت',
      colTask: 'نوع المهمة',
      colRoute: 'المسار',
      colModel: 'النموذج',
      colLatency: 'الزمن المقاس',
      colCost: 'التكلفة',
      colStatus: 'الحالة',
      benchmarkTitle: 'اختبار الأداء المباشر في المتصفح (8 مهام تمثيلية)',
      benchmarkSubtitle:
        'قس زمن استجابة Chrome Prompt API الفعلي (البداية الباردة مقابل الدافئة)، واستجابات Gemini السحابية الموثّقة، والتنقيح الهجين مباشرة داخل متصفحك.',
      benchmarkScopeLocal: 'محلي فقط (دون استهلاك سحابي)',
      benchmarkScopeFull: 'مقارنة شاملة من 8 مهام (محلي / سحابي / هجين)',
      benchmarkRunBtn: 'تشغيل الاختبار المباشر',
      benchmarkRunning: 'جارٍ تنفيذ الاختبار…',
      benchmarkCopyJson: 'نسخ تقرير JSON',
      benchmarkCopied: 'تم النسخ',
      benchmarkColdStart: 'أول تشغيل محلي',
      benchmarkWarmMean: 'متوسط التشغيل الدافئ',
      benchmarkSuccessRate: 'نسبة الإكمال',
      benchmarkHeapDelta: 'تغيّر الذاكرة',
      benchmarkDisclaimer:
        'ينفّذ طلبات حقيقية عبر المتصفح والخادم الموثّق فقط. عند غياب Chrome Prompt API أو تسجيل الدخول يتم حظر المسار بشفافية.',
    },
    settings: {
      title: 'الإعدادات والتشخيص',
      subtitle: 'إدارة اللغة والتحكم في حفظ المحادثات والمصادقة وحالة خدمات Firebase.',
      languageTitle: 'اللغة والاتجاه',
      languageDesc: 'التبديل الفوري بين الإنجليزية (LTR) والعربية (RTL).',
      storageTitle: 'التحكم في بيانات المحادثات',
      persistLabel: 'حفظ المحادثات في Cloud Firestore',
      persistDesc:
        'عند التعطيل، تبقى نصوص المحادثات في ذاكرة المتصفح للجلسة الحالية فقط. القياسات التقنية لا تخزّن محتوى الرسائل.',
      clearSessionBtn: 'مسح سجل الجلسة المحلي',
      clearCloudBtn: 'مسح قياسات السحابة',
      accountTitle: 'حساب Firebase',
      diagnosticsTitle: 'تشخيص البيئة والنشر',
      firebaseProjectLabel: 'مشروع Firebase',
      firestoreStatusLabel: 'اتصال Firestore',
      appCheckLabel: 'Firebase App Check',
      appCheckProviderLabel: 'المزوّد',
      cloudBackendLabel: 'مسار السحابة النشط',
      mobileReadinessTitle: 'المنصات المحلية المدعومة وجاهزية الجوال',
      mobileReadinessBody:
        'على الويب، يتطلب الاستدلال المحلي متصفح Chrome لسطح المكتب (الإصدار 138+) مع Chrome Prompt API (Gemini Nano). متصفحات Safari وFirefox وiOS WebKit لا تدعم LanguageModel. وحدة المحرك (src/engine/) خالية تماماً من اعتماديات المتصفح: يتطلب Android الإصدار 14+ مع Firebase AI Logic وML Kit AICore، ويتطلب Expo بناء تطوير مخصص (expo-dev-client).',
    },
  },
};
