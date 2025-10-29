import logger from "./logger.js";
import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';

// Comprehensive list of inappropriate words and patterns
const PROFANITY_LIST = [
  // Basic profanity
  'fuck', 'shit', 'damn', 'bitch', 'asshole', 'bastard', 'crap',
  'piss', 'whore', 'slut', 'cunt', 'cock', 'dick', 'pussy',
  
  // Sexual content
  'sex', 'porn', 'nude', 'naked', 'horny', 'masturbate', 'orgasm',
  'penis', 'vagina', 'breast', 'boob', 'tit', 'nipple', 'anal',
  'blowjob', 'handjob', 'cumshot', 'gangbang', 'threesome',
  
  // Hate speech and slurs
  'nigger', 'nigga', 'faggot', 'retard', 'spic', 'chink', 'kike',
  'wetback', 'towelhead', 'sandnigger', 'gook', 'jap',
  
  // Drug references
  'cocaine', 'heroin', 'meth', 'weed', 'marijuana', 'cannabis',
  'ecstasy', 'molly', 'lsd', 'crack', 'crystal', 'dope',
  
  // Violence
  'kill', 'murder', 'suicide', 'rape', 'torture', 'bomb',
  'terrorist', 'violence', 'assault', 'abuse',
  
  // Scam/fraud related
  'scam', 'fraud', 'steal', 'cheat', 'hack', 'phishing',
  'bitcoin', 'crypto', 'investment', 'money laundering'
];

// Off-platform transaction prevention filters
const OFF_PLATFORM_FILTERS = {
  // 1. Direct Contact Information
  emailDomains: [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 
    'protonmail.com', 'icloud.com', 'aol.com'
  ],
  
  emailPhrases: [
    'email me', 'send me your email', 'drop me your email',
    'contact me at', 'reach me at', 'my email is', 'email address',
    'etransfer to my email', 'send to my email' // Canada-specific Interac phrasing
  ],
  
  phonePhrases: [
    'call me', 'text me', 'sms me', 'reach me on phone',
    'phone number', 'contact number', 'call me at', 'text me at'
  ],
  
  // 2. Payment-Related Keywords
  paymentServices: [
    'paypal', 'venmo', 'cashapp', 'zelle', 'wise', 'revolut', 
    'western union', 'moneygram', 'pay pal', 'ven moo', 'cash app',
    'zell', 'w1se', 'rev0lut',
    'etransfer', 'e-transfer', 'interac', 'interac transfer', 'interac e-transfer',
    'interac etransfer', 'interac email transfer', 'etransfer canada', 'transferwise'
  ],
  
  bankingTerms: [
    'bank transfer', 'wire transfer', 'routing number', 'account number',
    'iban', 'swift', 'bank account', 'checking account', 'savings account',
    // Canadian banks
    'td', 'rbc', 'scotiabank', 'cibc', 'bmo', 'desjardins', 'national bank',
    'credit union', 'simplii', 'tangerine'
  ],
  
  cryptoTerms: [
    'crypto', 'cryptocurrency', 'digital currency',
    'bitcoin', 'btc', 'ethereum', 'eth', 'usdt', 'tether',
    'bnb', 'doge', 'wallet address', 'seed phrase', 'metamask',
    'trustwallet', 'coinbase', 
    // More coins used in Canada
    'usdc', 'ltc', 'litecoin', 'sol', 'solana', 'xrp', 'ripple'
  ],
  
  // 3. Social Media / Messaging Apps
  socialApps: [
    'whatsapp', 'telegram', 'signal', 'discord', 'instagram', 'facebook',
    'snapchat', 'linkedin', 'twitter', 'x', 'wechat', 'line', 'kakaotalk',
    'messenger', 'ig', 'insta', 'fb', 'sc', 'wa', 'li', 'x app', 't.me'
  ],
  
  socialObfuscations: [
    'whats@pp', 'wh@tsapp', 'tel3gram', 'd1scord', 'sig nal', 'lnkd',
    'f@cebook', '1nstagram', 'tw1tter', 'sn@pchat'
  ],
  
  // 4. Generic Phrases Indicating Off-Platform Move
  offPlatformPhrases: [
    "let's take this offline", "pay me directly", "cheaper outside platform",
    "save on fees", "skip the fees", "don't pay here", "contact me outside",
    "let's connect elsewhere", "future deals outside this app", "no need to use this site",
    "i'll give you my details", "send money another way", "better deal off here",
    "cut out the middleman", "continue off the app", "work with me directly",
    "don't go through the platform", "deal outside", "pay outside", "contact outside",
    // Canada-specific
    "send an etransfer", "pay by interac", "accepting e-transfer",
    "direct deposit", "deposit to account", "cash only", "meet up and pay"
  ],
  
  // 5. Workarounds & Obfuscations
  workarounds: [
    'dot', 'd0t', 'at', '(at)', '[at]', 'underscore', 'slash',
    'g m a i l', 'y a h o o', 'w h a t s a p p', 'one two three',
    'john_doe@gmail_com', 'john at gmail dot com', '(123) 456-7890',
    '{email}', '[number]', 'email at domain', 'phone at number',
    'one two three four five six seven eight nine zero', // Spelled out phone numbers
    'whats app', 'what\'s app', 'pay pal', 'cash app', 'ven moo', // Spaced app names
    // Canada-specific workarounds
    'e t r a n s f e r', 'etr@nsfer', 'inter@c', 'e tr@n$fer'
  ]
};

// Regex patterns for detecting off-platform communication
const OFF_PLATFORM_REGEX = {
  // Phone numbers: +?d{7,15}
  phoneNumbers: /\+?\d{7,15}/g,
  
  // Emails: [A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}
  emails: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  
  // URLs: (http(s)?://|www\.)\S+
  urls: /(http(s)?:\/\/|www\.)\S+/gi,
  
  // Crypto wallets
  ethWallet: /0x[a-fA-F0-9]{40}/g,
  btcWallet: /(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}/g,
  
  // Social media handles: @[A-Za-z0-9_]{2,20}
  socialHandles: /@[A-Za-z0-9_]{2,20}/g,
  
  // Common obfuscation patterns
  spacedLetters: /\b[a-z](\s+[a-z]){2,}\b/gi, // Loosened to catch longer obfuscations
  dotAtPattern: /\b[a-z]+\s+(?:dot|d0t)\s+[a-z]+\s+(?:at|@)\s+[a-z]+\b/gi,
  bracketPattern: /\([^)]*@[^)]*\)/gi,
  spelledOutNumbers: /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)){6,}\b/gi,
  spacedAppNames: /\b(?:whats?\s+app|pay\s+pal|cash\s+app|ven\s+moo|tele\s+gram|dis\s+cord|e\s*transfer|inter\s*ac)\b/gi
};

// Leetspeak and common substitutions
const LEETSPEAK_MAP = {
  '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i',
  '0': 'o', '5': 's', '$': 's', '7': 't', '+': 't',
  '8': 'b', '6': 'g', '9': 'g'
};


// Patterns for detecting attempts to bypass filters
const BYPASS_PATTERNS = [
  /(.)\1{2,}/g, // Repeated characters (e.g., "fuuuuck")
  /[^a-zA-Z0-9\s]/g, // Special characters used to break up words
  /\s+/g // Multiple spaces
];

/**
 * Normalize text to catch common bypass attempts
 * @param {string} text - The text to normalize
 * @returns {string} - Normalized text
 */
const normalizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  
  let normalized = text.toLowerCase();
  
  // Replace leetspeak
  Object.keys(LEETSPEAK_MAP).forEach(leet => {
    const regex = new RegExp(leet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    normalized = normalized.replace(regex, LEETSPEAK_MAP[leet]);
  });
  
  // Remove repeated characters (keep max 2)
  normalized = normalized.replace(/(.)\1{2,}/g, '$1$1');
  
  // Remove special characters and extra spaces
  normalized = normalized.replace(/[^a-zA-Z0-9\s]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
};

/**
 * Check if text contains profanity or inappropriate content
 * @param {string} text - The text to check
 * @returns {object} - Result object with isClean, violations, and cleanedText
 */
const filterContent = (text) => {
  if (!text || typeof text !== 'string') {
    return { isClean: true, violations: [], cleanedText: text };
  }

  const originalText = text;
  const normalizedText = normalizeText(text);
  const violations = [];
  let cleanedText = originalText;

  // Check for off-platform transaction attempts
  const offPlatformResult = checkOffPlatformAttempts(text);
  if (offPlatformResult.violations.length > 0) {
    violations.push(...offPlatformResult.violations);
    // Add categories for off-platform violations
    if (offPlatformResult.categories.includes('direct_contact')) violations.push('off_platform_direct_contact');
    if (offPlatformResult.categories.includes('payment')) violations.push('off_platform_payment');
    if (offPlatformResult.categories.includes('social_media')) violations.push('off_platform_social_media');
    if (offPlatformResult.categories.includes('off_platform')) violations.push('off_platform_phrase');
    if (offPlatformResult.categories.includes('obfuscation')) violations.push('off_platform_workaround');
    if (offPlatformResult.categories.includes('external_links')) violations.push('off_platform_url');
  }

  // Check for exact matches and partial matches
  PROFANITY_LIST.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const partialRegex = new RegExp(word, 'gi');
    
    // Check normalized text for violations
    if (regex.test(normalizedText) || partialRegex.test(normalizedText)) {
      violations.push(word);
      
      // Replace in original text (case insensitive)
      const replaceRegex = new RegExp(word, 'gi');
      cleanedText = cleanedText.replace(replaceRegex, '*'.repeat(word.length));
    }
  });

  // Additional pattern checks
  const suspiciousPatterns = [
    /\b(buy|sell|cheap|discount|offer|deal)\s+(viagra|cialis|pills)\b/gi,
    /\b(click|visit|go\s+to)\s+(http|www|\.com|\.net)\b/gi,
    /\b(send|give|transfer)\s+(money|cash|bitcoin|crypto)\b/gi,
    /\b(bank|account|password|ssn|social\s+security)\b/gi
  ];

  suspiciousPatterns.forEach((pattern, index) => {
    if (pattern.test(normalizedText)) {
      violations.push(`suspicious_pattern_${index}`);
    }
  });

  const isClean = violations.length === 0;

  // Log violations for monitoring
  if (!isClean) {
    logger.warn('Content filter violation detected', {
      originalText: originalText.substring(0, 100), // Log first 100 chars only
      violations: violations,
      timestamp: new Date().toISOString()
    });
  }

  return {
    isClean,
    violations,
    cleanedText,
    severity: violations.length > 3 ? 'high' : violations.length > 1 ? 'medium' : 'low'
  };
};

/**
 * Check if content should be blocked entirely
 * @param {string} text - The text to check
 * @returns {boolean} - True if content should be blocked
 */
const shouldBlockContent = (text) => {
  const result = filterContent(text);
  
  // Block if high severity or contains hate speech
  const hateWords = ['nigger', 'faggot', 'retard', 'kike', 'chink'];
  const containsHateSpeech = result.violations.some(violation => 
    hateWords.includes(violation)
  );
  
  // Block off-platform transaction attempts (always block these)
  const offPlatformViolations = result.violations.filter(v => 
    v.startsWith('off_platform_') || 
    v.startsWith('email_') || 
    v.startsWith('phone_') || 
    v.startsWith('payment_') || 
    v.startsWith('social_') || 
    v.startsWith('crypto_') || 
    v.startsWith('banking_') || 
    v.startsWith('workaround_') ||
    v.includes('_detected')
  );
  
  return result.severity === 'high' || containsHateSpeech || offPlatformViolations.length > 0;
};

/**
 * Get a user-friendly error message based on violations
 * @param {Array} violations - Array of violation words
 * @returns {string} - User-friendly error message
 */
const getViolationMessage = (violations) => {
  if (violations.length === 0) return '';
  
  // Check for off-platform transaction violations first (highest priority)
  const offPlatformViolations = violations.filter(v => 
    v.startsWith('off_platform_') || 
    v.startsWith('email_') || 
    v.startsWith('phone_') || 
    v.startsWith('payment_') || 
    v.startsWith('social_') || 
    v.startsWith('crypto_') || 
    v.startsWith('banking_') || 
    v.startsWith('workaround_') ||
    v.includes('_detected')
  );
  
  if (offPlatformViolations.length > 0) {
    // Determine the type of off-platform violation
    if (offPlatformViolations.some(v => v.includes('direct_contact') || v.includes('email') || v.includes('phone'))) {
      return 'Sharing personal contact information is not allowed. Please keep all communication within the platform.';
    }
    
    if (offPlatformViolations.some(v => v.includes('payment') || v.includes('crypto') || v.includes('banking'))) {
      return 'Discussing external payment methods or cryptocurrency is not allowed. Please use the platform\'s secure payment system.';
    }
    
    if (offPlatformViolations.some(v => v.includes('social_media') || v.includes('social_handle'))) {
      return 'Sharing social media handles or suggesting communication outside the platform is not allowed.';
    }
    
    if (offPlatformViolations.some(v => v.includes('off_platform') || v.includes('url'))) {
      return 'Attempting to move transactions outside the platform is not allowed. Please keep all business within the platform.';
    }
    
    return 'This message appears to be attempting to move communication or payment outside the platform, which is not allowed.';
  }
  
  // Check for other inappropriate content
  const categories = {
    profanity: ['fuck', 'shit', 'damn', 'bitch', 'ass', 'bastard', 'crap'],
    sexual: ['sex', 'porn', 'nude', 'naked', 'horny'],
    hate: ['nigger', 'faggot', 'retard'],
    drugs: ['cocaine', 'heroin', 'meth', 'weed'],
    violence: ['kill', 'murder', 'suicide', 'rape'],
    scam: ['scam', 'fraud', 'bitcoin', 'crypto']
  };
  
  for (const [category, words] of Object.entries(categories)) {
    if (violations.some(v => words.includes(v))) {
      switch (category) {
        case 'profanity':
          return 'Your message contains inappropriate language. Please keep the conversation professional.';
        case 'sexual':
          return 'Sexual content is not allowed in messages. Please keep conversations appropriate.';
        case 'hate':
          return 'Hate speech and discriminatory language are strictly prohibited.';
        case 'drugs':
          return 'Discussion of illegal substances is not permitted.';
        case 'violence':
          return 'Violent or threatening content is not allowed.';
        case 'scam':
          return 'Suspicious content detected. Please avoid discussing financial schemes.';
        default:
          return 'Your message contains inappropriate content. Please revise your message.';
      }
    }
  }
  
  return 'Your message contains inappropriate content. Please revise your message.';
};

// Configure AWS Rekognition for image content moderation (optional)
let rekognitionClient = null;
let rekognitionAvailable = false;

/**
 * Initialize AWS Rekognition client
 */
const initializeRekognition = async () => {
  if (rekognitionClient) {
    return;
  }
  try {
    if (process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      rekognitionClient = new RekognitionClient({
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
      rekognitionAvailable = true;
      logger.info('AWS Rekognition initialized for image content moderation');
    } else {
      logger.warn('AWS Rekognition not configured - image content moderation disabled');
    }
  } catch (error) {
    logger.warn('Failed to initialize AWS Rekognition:', error.message);
    rekognitionAvailable = false;
  }
};

/**
 * Analyze image content using AWS Rekognition for inappropriate content
 * @param {string} s3Key - The S3 key of the uploaded image
 * @param {number} minConfidence - Minimum confidence threshold (default: 60)
 * @returns {object} - Analysis result with moderation labels
 */
const analyzeImageContent = async (s3Key, minConfidence = 60) => {
  await initializeRekognition();
  // Check if image moderation is enabled
  if (process.env.ENABLE_IMAGE_MODERATION !== 'true') {
    logger.info('Image moderation disabled via ENABLE_IMAGE_MODERATION environment variable');
    return {
      isAppropriate: true,
      labels: [],
      violations: [],
      confidence: 0,
      severity: 'none',
      disabled: true
    };
  }

  // If Rekognition is not available, skip image analysis
  if (!rekognitionAvailable || !rekognitionClient) {
    logger.info('Image content analysis skipped - AWS Rekognition not available');
    return {
      isAppropriate: true,
      labels: [],
      violations: [],
      confidence: 0,
      severity: 'none',
      skipped: true
    };
  }

  try {
    const command = new DetectModerationLabelsCommand({
      Image: {
        S3Object: {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Name: s3Key,
        },
      },
      MinConfidence: minConfidence,
    });

    const response = await rekognitionClient.send(command);
    
    // Categorize the violations
    const violations = response.ModerationLabels.map(label => ({
      name: label.Name,
      confidence: label.Confidence,
      category: categorizeViolation(label.Name)
    }));

    return {
      isAppropriate: response.ModerationLabels.length === 0,
      labels: response.ModerationLabels,
      violations,
      confidence: response.ModerationLabels.length > 0 
        ? Math.max(...response.ModerationLabels.map(label => label.Confidence))
        : 0,
      severity: getSeverityLevel(violations)
    };
  } catch (error) {
    logger.error('Error analyzing image content with Rekognition:', error);
    // If Rekognition fails, allow the image but log the error
    return {
      isAppropriate: true,
      labels: [],
      violations: [],
      confidence: 0,
      severity: 'none',
      error: error.message,
      fallback: true
    };
  }
};

/**
 * Categorize violation types
 * @param {string} labelName - The label name from Rekognition
 * @returns {string} - Category of violation
 */
const categorizeViolation = (labelName) => {
  const name = labelName.toLowerCase();
  
  if (name.includes('nudity') || name.includes('explicit')) {
    return 'nudity';
  }
  if (name.includes('violence') || name.includes('graphic')) {
    return 'violence';
  }
  if (name.includes('drug') || name.includes('substance')) {
    return 'drugs';
  }
  if (name.includes('hate') || name.includes('symbol')) {
    return 'hate';
  }
  if (name.includes('weapon')) {
    return 'weapons';
  }
  
  return 'inappropriate';
};

/**
 * Determine severity level based on violations
 * @param {Array} violations - Array of violation objects
 * @returns {string} - Severity level
 */
const getSeverityLevel = (violations) => {
  if (violations.length === 0) return 'none';
  
  const highSeverityCategories = ['nudity', 'violence', 'hate', 'weapons'];
  const hasHighSeverity = violations.some(v => 
    highSeverityCategories.includes(v.category) && v.confidence > 80
  );
  
  if (hasHighSeverity) return 'high';
  if (violations.length > 2 || violations.some(v => v.confidence > 70)) return 'medium';
  return 'low';
};

/**
 * Get user-friendly message for image moderation violations
 * @param {Array} violations - Violation objects from image analysis
 * @param {string} context - Context where image is being used (chat, post, profile)
 * @returns {string} - User-friendly error message
 */
const getImageViolationMessage = (violations, context = 'shared') => {
  if (!violations || violations.length === 0) return '';

  const categories = violations.map(v => v.category);
  
  if (categories.includes('nudity')) {
    return `This image contains nudity and cannot be ${context}.`;
  }
  
  if (categories.includes('violence')) {
    return `This image contains violent content and cannot be ${context}.`;
  }
  
  if (categories.includes('drugs')) {
    return `This image contains drug-related content and cannot be ${context}.`;
  }
  
  if (categories.includes('hate')) {
    return `This image contains inappropriate symbols or gestures and cannot be ${context}.`;
  }
  
  if (categories.includes('weapons')) {
    return `This image contains weapon-related content and cannot be ${context}.`;
  }
  
  return `This image contains inappropriate content and cannot be ${context}.`;
};

/**
 * Check if image should be blocked entirely based on severity
 * @param {object} analysisResult - Result from analyzeImageContent
 * @returns {boolean} - True if image should be blocked
 */
const shouldBlockImage = (analysisResult) => {
  if (!analysisResult || analysisResult.isAppropriate) return false;
  
  // Block high severity violations or multiple medium confidence violations
  return analysisResult.severity === 'high' || 
         (analysisResult.severity === 'medium' && analysisResult.confidence > 75);
};

/**
 * Check for off-platform transaction attempts
 * @param {string} text - The text to check
 * @returns {object} - Result object with violations and categories
 */
const checkOffPlatformAttempts = (text) => {
  if (!text || typeof text !== 'string') {
    return { violations: [], categories: [] };
  }

  const lowerText = text.toLowerCase();
  const violations = [];
  const categories = [];

  // Check email domains
  OFF_PLATFORM_FILTERS.emailDomains.forEach(domain => {
    const regex = new RegExp(`@${domain.replace(/\./g, '\\.')}`, 'gi');
    if (regex.test(text)) {
      violations.push(`email_domain_${domain}`);
      if (!categories.includes('direct_contact')) categories.push('direct_contact');
    }
  });

  // Check email phrases
  OFF_PLATFORM_FILTERS.emailPhrases.forEach(phrase => {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`email_phrase_${phrase}`);
      if (!categories.includes('direct_contact')) categories.push('direct_contact');
    }
  });

  // Check phone phrases
  OFF_PLATFORM_FILTERS.phonePhrases.forEach(phrase => {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`phone_phrase_${phrase}`);
      if (!categories.includes('direct_contact')) categories.push('direct_contact');
    }
  });

  // Check payment services
  OFF_PLATFORM_FILTERS.paymentServices.forEach(service => {
    const regex = new RegExp(`\\b${service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`payment_service_${service}`);
      if (!categories.includes('payment')) categories.push('payment');
    }
  });

  // Check banking terms
  OFF_PLATFORM_FILTERS.bankingTerms.forEach(term => {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`banking_term_${term}`);
      if (!categories.includes('payment')) categories.push('payment');
    }
  });

  // Check crypto terms
  OFF_PLATFORM_FILTERS.cryptoTerms.forEach(term => {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`crypto_term_${term}`);
      if (!categories.includes('payment')) categories.push('payment');
    }
  });

  // Check social media apps
  OFF_PLATFORM_FILTERS.socialApps.forEach(app => {
    const regex = new RegExp(`\\b${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`social_app_${app}`);
      if (!categories.includes('social_media')) categories.push('social_media');
    }
  });

  // Check social obfuscations
  OFF_PLATFORM_FILTERS.socialObfuscations.forEach(obfuscation => {
    const regex = new RegExp(`\\b${obfuscation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`social_obfuscation_${obfuscation}`);
      if (!categories.includes('social_media')) categories.push('social_media');
    }
  });

  // Check off-platform phrases
  OFF_PLATFORM_FILTERS.offPlatformPhrases.forEach(phrase => {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`off_platform_phrase_${phrase}`);
      if (!categories.includes('off_platform')) categories.push('off_platform');
    }
  });

  // Check workarounds
  OFF_PLATFORM_FILTERS.workarounds.forEach(workaround => {
    const regex = new RegExp(`\\b${workaround.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(lowerText)) {
      violations.push(`workaround_${workaround}`);
      if (!categories.includes('obfuscation')) categories.push('obfuscation');
    }
  });

  // Check regex patterns
  const regexMatches = {};
  
  // Phone numbers
  const phoneMatches = text.match(OFF_PLATFORM_REGEX.phoneNumbers);
  if (phoneMatches) {
    regexMatches.phoneNumbers = phoneMatches;
    violations.push('phone_number_detected');
    if (!categories.includes('direct_contact')) categories.push('direct_contact');
  }

  // Emails
  const emailMatches = text.match(OFF_PLATFORM_REGEX.emails);
  if (emailMatches) {
    regexMatches.emails = emailMatches;
    violations.push('email_address_detected');
    if (!categories.includes('direct_contact')) categories.push('direct_contact');
  }

  // URLs
  const urlMatches = text.match(OFF_PLATFORM_REGEX.urls);
  if (urlMatches) {
    regexMatches.urls = urlMatches;
    violations.push('url_detected');
    if (!categories.includes('external_links')) categories.push('external_links');
  }

  // Crypto wallets
  const ethMatches = text.match(OFF_PLATFORM_REGEX.ethWallet);
  if (ethMatches) {
    regexMatches.ethWallets = ethMatches;
    violations.push('crypto_wallet_eth');
    if (!categories.includes('payment')) categories.push('payment');
  }

  const btcMatches = text.match(OFF_PLATFORM_REGEX.btcWallet);
  if (btcMatches) {
    regexMatches.btcWallets = btcMatches;
    violations.push('crypto_wallet_btc');
    if (!categories.includes('payment')) categories.push('payment');
  }

  // Social handles
  const socialMatches = text.match(OFF_PLATFORM_REGEX.socialHandles);
  if (socialMatches) {
    regexMatches.socialHandles = socialMatches;
    violations.push('social_handle_detected');
    if (!categories.includes('social_media')) categories.push('social_media');
  }

  // Check additional obfuscation patterns
  const spelledOutMatches = text.match(OFF_PLATFORM_REGEX.spelledOutNumbers);
  if (spelledOutMatches) {
    regexMatches.spelledOutNumbers = spelledOutMatches;
    violations.push('spelled_out_phone_detected');
    if (!categories.includes('direct_contact')) categories.push('direct_contact');
  }

  const spacedAppMatches = text.match(OFF_PLATFORM_REGEX.spacedAppNames);
  if (spacedAppMatches) {
    regexMatches.spacedAppNames = spacedAppMatches;
    violations.push('spaced_app_name_detected');
    if (!categories.includes('social_media')) categories.push('social_media');
  }

  return { violations, categories, regexMatches };
};

export {
  filterContent,
  shouldBlockContent,
  getViolationMessage,
  analyzeImageContent,
  getImageViolationMessage,
  shouldBlockImage,
};