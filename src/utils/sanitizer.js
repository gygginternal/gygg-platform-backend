import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize text content for XSS protection
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
export const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return text;

  // First apply basic XSS sanitization using sanitize-html
  const sanitized = sanitizeHtml(text, {
    allowedTags: [], // No HTML tags allowed for chat messages
    allowedAttributes: {},
    textFilter: function(text) {
      // Additional sanitization for any remaining dangerous characters
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    }
  });

  return sanitized;
};

/**
 * Sanitize rich text content (if needed for future features)
 * @param {string} text - Rich text to sanitize
 * @returns {string} - Sanitized rich text
 */
export const sanitizeRichText = (text) => {
  if (!text || typeof text !== 'string') return text;

  return sanitizeHtml(text, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'
    ],
    allowedAttributes: {},
    textFilter: function(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  });
};

/**
 * Sanitize message content comprehensively
 * @param {string} content - Message content to sanitize
 * @param {string} type - Type of content ('text', 'html', etc.)
 * @returns {string} - Sanitized content
 */
export const sanitizeMessageContent = (content, type = 'text') => {
  if (!content || typeof content !== 'string') return content;

  switch (type) {
    case 'html':
      return sanitizeRichText(content);
    case 'text':
    default:
      return sanitizeText(content);
  }
};

/**
 * Sanitize user input with multiple layers of protection
 * @param {any} input - Input to sanitize
 * @returns {any} - Sanitized input
 */
export const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    // Sanitize string inputs
    return sanitizeText(input);
  } else if (Array.isArray(input)) {
    // Sanitize array elements
    return input.map(item => sanitizeInput(item));
  } else if (typeof input === 'object' && input !== null) {
    // Sanitize object properties
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  // Return primitive values as-is
  return input;
};

/**
 * Comprehensive XSS protection patterns
 */
export const xssPatterns = [
  // JavaScript event handlers
  /on\w+\s*=/gi,
  // JavaScript protocols
  /javascript:/gi,
  /vbscript:/gi,
  /data:/gi,
  /file:/gi,
  // CSS expressions
  /expression\(/gi,
  /eval\(/gi,
  /alert\(/gi,
  // HTML comments
  /<!--/g,
  /-->/g,
  // Embedded script tags (case insensitive)
  /<\s*script[^>]*>.*?<\s*\/\s*script\s*>/gi,
  /<\s*iframe[^>]*>.*?<\s*\/\s*iframe\s*>/gi,
  /<\s*frame[^>]*>.*?<\s*\/\s*frame\s*>/gi,
  /<\s*frameset[^>]*>.*?<\s*\/\s*frameset\s*>/gi,
  /<\s*object[^>]*>.*?<\s*\/\s*object\s*>/gi,
  /<\s*embed[^>]*>.*?<\s*\/\s*embed\s*>/gi,
  /<\s*applet[^>]*>.*?<\s*\/\s*applet\s*>/gi,
  /<\s*form[^>]*>.*?<\s*\/\s*form\s*>/gi
];