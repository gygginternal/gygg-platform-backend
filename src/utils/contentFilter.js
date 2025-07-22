import logger from "./logger.js";
import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';

// Comprehensive list of inappropriate words and patterns
const PROFANITY_LIST = [
  // Basic profanity
  'fuck', 'shit', 'damn', 'bitch', 'ass', 'asshole', 'bastard', 'crap',
  'piss', 'hell', 'whore', 'slut', 'cunt', 'cock', 'dick', 'pussy',
  
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
export const filterContent = (text) => {
  if (!text || typeof text !== 'string') {
    return { isClean: true, violations: [], cleanedText: text };
  }

  const originalText = text;
  const normalizedText = normalizeText(text);
  const violations = [];
  let cleanedText = originalText;

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
export const shouldBlockContent = (text) => {
  const result = filterContent(text);
  
  // Block if high severity or contains hate speech
  const hateWords = ['nigger', 'faggot', 'retard', 'kike', 'chink'];
  const containsHateSpeech = result.violations.some(violation => 
    hateWords.includes(violation)
  );
  
  return result.severity === 'high' || containsHateSpeech;
};

/**
 * Get a user-friendly error message based on violations
 * @param {Array} violations - Array of violation words
 * @returns {string} - User-friendly error message
 */
export const getViolationMessage = (violations) => {
  if (violations.length === 0) return '';
  
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

try {
  if (process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const { RekognitionClient } = await import('@aws-sdk/client-rekognition');
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

/**
 * Analyze image content using AWS Rekognition for inappropriate content
 * @param {string} s3Key - The S3 key of the uploaded image
 * @param {number} minConfidence - Minimum confidence threshold (default: 60)
 * @returns {object} - Analysis result with moderation labels
 */
export const analyzeImageContent = async (s3Key, minConfidence = 60) => {
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
    const { DetectModerationLabelsCommand } = await import('@aws-sdk/client-rekognition');
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
export const getImageViolationMessage = (violations, context = 'shared') => {
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
export const shouldBlockImage = (analysisResult) => {
  if (!analysisResult || analysisResult.isAppropriate) return false;
  
  // Block high severity violations or multiple medium confidence violations
  return analysisResult.severity === 'high' || 
         (analysisResult.severity === 'medium' && analysisResult.confidence > 75);
};