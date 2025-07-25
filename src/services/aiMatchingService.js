const User = require('../models/User');
const Gig = require('../models/Gig');
const Contract = require('../models/Contract');

/**
 * Advanced AI Matching Service
 * Provides sophisticated matching algorithms and machine learning capabilities
 */

class AIMatchingService {
  constructor() {
    this.matchingHistory = new Map(); // Cache for performance
    this.userPreferences = new Map(); // User preference learning
  }

  /**
   * Advanced personality matching using psychological compatibility
   * @param {Array} personality1 - First user's personality traits
   * @param {Array} personality2 - Second user's personality traits
   * @returns {Object} - Detailed personality compatibility analysis
   */
  analyzePersonalityCompatibility(personality1, personality2) {
    // Big Five personality model compatibility matrix
    const compatibilityMatrix = {
      'openness': {
        compatible: ['creativity', 'curiosity', 'flexibility'],
        complementary: ['organization', 'structure', 'planning'],
        conflicting: ['rigidity', 'close-mindedness']
      },
      'conscientiousness': {
        compatible: ['reliability', 'organization', 'punctuality'],
        complementary: ['creativity', 'spontaneity'],
        conflicting: ['carelessness', 'disorganization']
      },
      'extraversion': {
        compatible: ['social', 'energetic', 'assertive'],
        complementary: ['listening', 'thoughtful', 'calm'],
        conflicting: ['antisocial', 'withdrawn']
      },
      'agreeableness': {
        compatible: ['cooperative', 'trusting', 'helpful'],
        complementary: ['leadership', 'decisive'],
        conflicting: ['aggressive', 'competitive']
      },
      'neuroticism': {
        compatible: ['calm', 'stable', 'resilient'],
        complementary: ['empathetic', 'supportive'],
        conflicting: ['anxious', 'moody', 'stressed']
      }
    };

    let compatibilityScore = 0;
    let totalComparisons = 0;
    const analysis = {
      strengths: [],
      challenges: [],
      recommendations: []
    };

    personality1?.forEach(trait1 => {
      personality2?.forEach(trait2 => {
        totalComparisons++;
        
        // Check for direct compatibility
        Object.entries(compatibilityMatrix).forEach(([category, rules]) => {
          if (rules.compatible.includes(trait1.toLowerCase()) && 
              rules.compatible.includes(trait2.toLowerCase())) {
            compatibilityScore += 100;
            analysis.strengths.push(`Both share ${category} traits`);
          } else if (rules.compatible.includes(trait1.toLowerCase()) && 
                     rules.complementary.includes(trait2.toLowerCase())) {
            compatibilityScore += 80;
            analysis.strengths.push(`Complementary ${category} traits`);
          } else if (rules.compatible.includes(trait1.toLowerCase()) && 
                     rules.conflicting.includes(trait2.toLowerCase())) {
            compatibilityScore += 20;
            analysis.challenges.push(`Potential ${category} conflict`);
          }
        });
      });
    });

    return {
      score: totalComparisons > 0 ? compatibilityScore / totalComparisons : 50,
      analysis,
      confidence: Math.min(totalComparisons / 10, 1) // Confidence based on data availability
    };
  }

  /**
   * Calculate geographic distance and compatibility
   * @param {Object} address1 - First address
   * @param {Object} address2 - Second address
   * @returns {Object} - Location analysis with distance and score
   */
  analyzeLocationCompatibility(address1, address2) {
    if (!address1 || !address2) {
      return { score: 0, distance: null, analysis: 'Location data unavailable' };
    }

    // Simplified distance calculation (in a real app, use proper geocoding)
    let distance = null;
    let score = 0;
    let analysis = '';

    if (address1.city && address2.city) {
      if (address1.city.toLowerCase() === address2.city.toLowerCase()) {
        distance = 0;
        score = 100;
        analysis = 'Same city - excellent for in-person collaboration';
      } else if (address1.state && address2.state && 
                 address1.state.toLowerCase() === address2.state.toLowerCase()) {
        distance = 50; // Estimated
        score = 75;
        analysis = 'Same state - good for regional projects';
      } else if (address1.country && address2.country && 
                 address1.country.toLowerCase() === address2.country.toLowerCase()) {
        distance = 200; // Estimated
        score = 50;
        analysis = 'Same country - suitable for remote work';
      } else {
        distance = 500; // Estimated
        score = 25;
        analysis = 'Different countries - remote work only';
      }
    }

    return {
      score,
      distance,
      analysis,
      sameCity: address1.city?.toLowerCase() === address2.city?.toLowerCase(),
      sameState: address1.state?.toLowerCase() === address2.state?.toLowerCase(),
      sameCountry: address1.country?.toLowerCase() === address2.country?.toLowerCase()
    };
  }

  /**
   * Analyze skill complementarity and overlap
   * @param {Array} skills1 - First user's skills
   * @param {Array} skills2 - Second user's skills
   * @returns {Object} - Skill analysis
   */
  analyzeSkillCompatibility(skills1, skills2) {
    if (!skills1 || !skills2) {
      return { score: 0, analysis: 'Skill data unavailable' };
    }

    const normalizedSkills1 = skills1.map(s => s.toLowerCase());
    const normalizedSkills2 = skills2.map(s => s.toLowerCase());

    const commonSkills = normalizedSkills1.filter(skill => 
      normalizedSkills2.includes(skill)
    );

    const complementarySkills = this.findComplementarySkills(normalizedSkills1, normalizedSkills2);
    
    const overlapScore = (commonSkills.length / Math.max(normalizedSkills1.length, normalizedSkills2.length)) * 100;
    const complementaryScore = (complementarySkills.length / normalizedSkills1.length) * 100;
    
    const totalScore = (overlapScore * 0.6) + (complementaryScore * 0.4);

    return {
      score: Math.min(totalScore, 100),
      commonSkills,
      complementarySkills,
      analysis: this.generateSkillAnalysis(commonSkills, complementarySkills)
    };
  }

  /**
   * Find complementary skills based on predefined relationships
   * @param {Array} skills1 - First user's skills
   * @param {Array} skills2 - Second user's skills
   * @returns {Array} - Complementary skill pairs
   */
  findComplementarySkills(skills1, skills2) {
    const complementaryPairs = {
      'frontend': ['backend', 'ui/ux', 'design'],
      'backend': ['frontend', 'database', 'api'],
      'design': ['development', 'frontend', 'marketing'],
      'marketing': ['design', 'content', 'analytics'],
      'project management': ['development', 'design', 'testing'],
      'data analysis': ['visualization', 'statistics', 'reporting'],
      'writing': ['editing', 'research', 'marketing'],
      'photography': ['editing', 'design', 'marketing']
    };

    const complementary = [];
    
    skills1.forEach(skill1 => {
      skills2.forEach(skill2 => {
        if (complementaryPairs[skill1]?.includes(skill2) ||
            complementaryPairs[skill2]?.includes(skill1)) {
          complementary.push({ skill1, skill2 });
        }
      });
    });

    return complementary;
  }

  /**
   * Generate human-readable skill analysis
   * @param {Array} commonSkills - Common skills
   * @param {Array} complementarySkills - Complementary skills
   * @returns {string} - Analysis text
   */
  generateSkillAnalysis(commonSkills, complementarySkills) {
    let analysis = '';
    
    if (commonSkills.length > 0) {
      analysis += `Shared expertise in ${commonSkills.slice(0, 3).join(', ')}. `;
    }
    
    if (complementarySkills.length > 0) {
      analysis += `Complementary skills that work well together. `;
    }
    
    if (commonSkills.length === 0 && complementarySkills.length === 0) {
      analysis = 'Limited skill overlap - may require additional coordination.';
    }
    
    return analysis.trim();
  }

  /**
   * Learn from user interactions and feedback
   * @param {string} userId - User ID
   * @param {string} matchId - Matched user ID
   * @param {string} action - User action (viewed, contacted, hired, etc.)
   * @param {number} rating - User rating of the match (1-5)
   */
  async learnFromInteraction(userId, matchId, action, rating = null) {
    try {
      // Store interaction for machine learning
      const interaction = {
        userId,
        matchId,
        action,
        rating,
        timestamp: new Date()
      };

      // Update user preferences based on successful matches
      if (action === 'hired' || (rating && rating >= 4)) {
        await this.updateUserPreferences(userId, matchId);
      }

      // Store in database for future ML training
      // This would typically go to a separate analytics database
      console.log('Learning from interaction:', interaction);
      
    } catch (error) {
      console.error('Error learning from interaction:', error);
    }
  }

  /**
   * Update user preferences based on successful matches
   * @param {string} userId - User ID
   * @param {string} matchId - Successfully matched user ID
   */
  async updateUserPreferences(userId, matchId) {
    try {
      const user = await User.findById(userId);
      const match = await User.findById(matchId);
      
      if (!user || !match) return;

      // Extract preferences from successful match
      const preferences = {
        preferredHobbies: match.hobbies || [],
        preferredSkills: match.skills || [],
        preferredLocation: match.address,
        preferredPersonality: match.personality || []
      };

      // Store or update user preferences
      this.userPreferences.set(userId, preferences);
      
      // In a real implementation, this would be stored in the database
      console.log(`Updated preferences for user ${userId}:`, preferences);
      
    } catch (error) {
      console.error('Error updating user preferences:', error);
    }
  }

  /**
   * Get personalized matching recommendations
   * @param {string} userId - User ID
   * @returns {Object} - Personalized recommendations
   */
  async getPersonalizedRecommendations(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      const preferences = this.userPreferences.get(userId) || {};
      const recommendations = {
        profileImprovements: [],
        matchingTips: [],
        skillSuggestions: []
      };

      // Analyze user's profile completeness
      if (!user.hobbies || user.hobbies.length < 3) {
        recommendations.profileImprovements.push({
          type: 'hobbies',
          suggestion: 'Add more hobbies to improve matching accuracy',
          impact: 'high'
        });
      }

      if (!user.bio || user.bio.length < 50) {
        recommendations.profileImprovements.push({
          type: 'bio',
          suggestion: 'Write a detailed bio to attract better matches',
          impact: 'medium'
        });
      }

      // Suggest skills based on successful matches
      if (preferences.preferredSkills && preferences.preferredSkills.length > 0) {
        const suggestedSkills = preferences.preferredSkills.filter(skill => 
          !user.skills?.includes(skill)
        );
        
        if (suggestedSkills.length > 0) {
          recommendations.skillSuggestions.push({
            skills: suggestedSkills.slice(0, 3),
            reason: 'Based on your successful matches'
          });
        }
      }

      return recommendations;
      
    } catch (error) {
      console.error('Error getting personalized recommendations:', error);
      return { profileImprovements: [], matchingTips: [], skillSuggestions: [] };
    }
  }

  /**
   * Predict match success probability
   * @param {Object} user1 - First user
   * @param {Object} user2 - Second user
   * @returns {Object} - Success prediction with confidence
   */
  predictMatchSuccess(user1, user2) {
    // This would use machine learning in a real implementation
    // For now, we'll use a rule-based approach
    
    const factors = {
      hobbiesMatch: this.calculateJaccardSimilarity(user1.hobbies, user2.hobbies),
      locationMatch: this.analyzeLocationCompatibility(user1.address, user2.address).score / 100,
      skillsMatch: this.analyzeSkillCompatibility(user1.skills, user2.skills).score / 100,
      ratingFactor: (user2.rating || 3) / 5
    };

    // Weighted prediction
    const successProbability = (
      factors.hobbiesMatch * 0.3 +
      factors.locationMatch * 0.25 +
      factors.skillsMatch * 0.25 +
      factors.ratingFactor * 0.2
    );

    const confidence = Math.min(
      (user1.hobbies?.length || 0) / 5 +
      (user1.skills?.length || 0) / 10 +
      (user2.hobbies?.length || 0) / 5 +
      (user2.skills?.length || 0) / 10,
      1
    );

    return {
      successProbability: Math.round(successProbability * 100),
      confidence: Math.round(confidence * 100),
      keyFactors: Object.entries(factors)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([factor, score]) => ({ factor, score: Math.round(score * 100) }))
    };
  }

  /**
   * Calculate Jaccard similarity (helper method)
   */
  calculateJaccardSimilarity(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) return 0;
    
    const set1 = new Set(arr1.map(item => item.toLowerCase()));
    const set2 = new Set(arr2.map(item => item.toLowerCase()));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
}

// Export singleton instance
module.exports = new AIMatchingService();