# AI Matching API Documentation

## Overview

The AI Matching API provides sophisticated matching algorithms to connect taskers and providers based on multiple compatibility factors including hobbies, personality traits, location, skills, and ratings.

## Features

- **Multi-factor Matching**: Considers hobbies, location, personality, skills, and ratings
- **Weighted Scoring**: Configurable weights for different matching criteria
- **Personality Compatibility**: Advanced psychological compatibility analysis
- **Location Intelligence**: Geographic proximity scoring
- **Skill Complementarity**: Identifies both overlapping and complementary skills
- **Machine Learning Ready**: Learns from user interactions and feedback
- **Caching**: High-performance caching for frequently requested matches
- **Rate Limiting**: Prevents API abuse with tiered rate limits
- **Comprehensive Analytics**: Detailed insights and recommendations

## Authentication

All endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. Find Matching Taskers for Provider

**GET** `/api/ai-matching/taskers/:providerId`

Find taskers that match well with a specific provider.

#### Parameters

- `providerId` (path) - Provider's user ID

#### Query Parameters

- `limit` (optional) - Number of results (1-100, default: 20)
- `minScore` (optional) - Minimum matching score (0-100, default: 50)
- `includeReasons` (optional) - Include match reasons (default: true)
- `sortBy` (optional) - Sort criteria: `score`, `rating`, `rate` (default: score)

#### Response

```json
{
  "status": "success",
  "results": 15,
  "data": {
    "matches": [
      {
        "_id": "user123",
        "firstName": "Jane",
        "lastName": "Doe",
        "profileImage": "profile.jpg",
        "bio": "Experienced web developer...",
        "rating": 4.8,
        "ratePerHour": 75,
        "hobbies": ["photography", "reading"],
        "skills": ["React", "Node.js"],
        "address": {
          "city": "Toronto",
          "state": "Ontario",
          "country": "Canada"
        },
        "matchScore": 87,
        "matchBreakdown": {
          "hobbies": 75,
          "location": 100,
          "personality": 82,
          "skills": 65,
          "rating": 96
        },
        "matchReasons": [
          "Shares 2 common hobbies: photography, reading",
          "Both located in Toronto",
          "Highly rated tasker (4.8/5.0)"
        ]
      }
    ],
    "provider": {
      "id": "provider123",
      "hobbies": ["photography", "gardening"],
      "skills": ["project management"],
      "location": {
        "city": "Toronto",
        "state": "Ontario"
      }
    }
  }
}
```

### 2. Find Matching Providers for Tasker

**GET** `/api/ai-matching/providers/:taskerId`

Find providers that match well with a specific tasker.

#### Parameters

- `taskerId` (path) - Tasker's user ID

#### Query Parameters

- `limit` (optional) - Number of results (1-100, default: 20)
- `minScore` (optional) - Minimum matching score (0-100, default: 50)
- `includeReasons` (optional) - Include match reasons (default: true)
- `sortBy` (optional) - Sort criteria: `score`, `rating` (default: score)
- `hasActiveGigs` (optional) - Only providers with active gigs (default: false)

#### Response

Similar to tasker matching but returns provider data.

### 3. Get Matching Insights

**GET** `/api/ai-matching/insights/:userId`

Get detailed insights and recommendations for improving match quality.

#### Parameters

- `userId` (path) - User's ID

#### Response

```json
{
  "status": "success",
  "data": {
    "insights": {
      "totalPotentialMatches": 150,
      "averageMatchScore": 67,
      "highQualityMatches": 25,
      "goodMatches": 45,
      "averageMatches": 80,
      "recommendations": [
        {
          "type": "hobbies",
          "message": "Add more hobbies to your profile to improve matching",
          "impact": "high"
        }
      ]
    },
    "userProfile": {
      "hobbies": 3,
      "skills": 7,
      "hasLocation": true,
      "hasPersonality": true
    }
  }
}
```

### 4. Batch Matching (Admin Only)

**POST** `/api/ai-matching/batch`

Perform batch matching for multiple users (analytics/admin use).

#### Request Body

```json
{
  "userIds": ["user1", "user2", "user3"],
  "targetRole": "tasker"
}
```

#### Response

```json
{
  "status": "success",
  "data": {
    "batchResults": [
      {
        "userId": "user1",
        "userName": "John Doe",
        "topMatches": [
          {
            "targetId": "tasker1",
            "targetName": "Jane Smith",
            "matchScore": 89
          }
        ]
      }
    ]
  }
}
```

## Matching Algorithm

### Scoring Weights

The matching algorithm uses weighted scoring across multiple factors:

- **Hobbies**: 30% - Shared interests and activities
- **Location**: 25% - Geographic proximity
- **Personality**: 20% - Psychological compatibility
- **Skills**: 15% - Professional capabilities overlap
- **Rating**: 10% - Historical performance rating

### Calculation Methods

#### 1. Hobby Similarity
Uses Jaccard similarity coefficient:
```
similarity = |intersection| / |union|
```

#### 2. Location Scoring
- Same city: 100 points
- Same state: 75 points
- Same country: 50 points
- Different country: 25 points

#### 3. Personality Compatibility
Based on psychological compatibility matrix considering:
- Direct trait matches
- Complementary traits
- Conflicting traits

#### 4. Skill Analysis
- Direct skill overlap
- Complementary skill identification
- Professional synergy assessment

### Match Reasons Generation

The system automatically generates human-readable explanations for why users match well, including:
- Common interests and hobbies
- Geographic proximity
- Skill complementarity
- High ratings and reviews
- Personality compatibility

## Rate Limiting

### Standard Users
- 50 requests per 15 minutes per IP
- Applies to all matching endpoints

### Premium Users
- 200 requests per 15 minutes per IP
- Higher limits for enhanced service

### Admin Users
- No rate limiting
- Full access to all endpoints

## Caching

### Cache Strategy
- Results cached for 1 hour (3600 seconds)
- Cache key based on endpoint, user ID, and query parameters
- Automatic cache invalidation on profile updates

### Cache Headers
Cached responses include:
```json
{
  "cached": true,
  "cacheTimestamp": "2024-01-15T10:30:00Z"
}
```

## Error Handling

### Common Error Codes

#### 400 Bad Request
```json
{
  "status": "error",
  "message": "Limit must be a number between 1 and 100"
}
```

#### 401 Unauthorized
```json
{
  "status": "error",
  "message": "Please log in to access this resource"
}
```

#### 403 Forbidden
```json
{
  "status": "error",
  "message": "You can only request matches for your own profile"
}
```

#### 404 Not Found
```json
{
  "status": "error",
  "message": "User not found"
}
```

#### 429 Too Many Requests
```json
{
  "status": "error",
  "message": "Too many matching requests from this IP, please try again later"
}
```

## Performance Considerations

### Optimization Strategies
1. **Caching**: Aggressive caching of matching results
2. **Database Indexing**: Optimized queries with proper indexes
3. **Pagination**: Limited result sets to prevent large responses
4. **Rate Limiting**: Prevents system overload
5. **Async Processing**: Non-blocking operations where possible

### Recommended Usage Patterns
1. Cache results on client side when appropriate
2. Use pagination for large result sets
3. Implement exponential backoff for rate limit handling
4. Batch requests when possible for admin operations

## Machine Learning Integration

### Learning from Interactions
The system learns from user behavior:
- Profile views
- Contact attempts
- Successful hires
- User ratings and feedback

### Personalization
- Adapts matching weights based on user preferences
- Improves recommendations over time
- Identifies successful matching patterns

### Future Enhancements
- Deep learning models for personality analysis
- Natural language processing for bio analysis
- Collaborative filtering recommendations
- Real-time location-based matching

## Security Considerations

### Data Privacy
- User data is anonymized in analytics
- Sensitive information is not exposed in responses
- GDPR compliance for data handling

### Access Control
- Users can only access their own matching data
- Admin endpoints require elevated permissions
- Rate limiting prevents abuse

### Data Validation
- All input parameters are validated
- SQL injection prevention
- XSS protection in responses

## Integration Examples

### Frontend Integration

```javascript
// Find matching taskers
const findTaskers = async (providerId, options = {}) => {
  const params = new URLSearchParams(options);
  const response = await fetch(
    `/api/ai-matching/taskers/${providerId}?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.json();
};

// Usage
const matches = await findTaskers('provider123', {
  limit: 10,
  minScore: 70,
  sortBy: 'score'
});
```

### Error Handling

```javascript
try {
  const matches = await findTaskers(providerId);
  displayMatches(matches.data.matches);
} catch (error) {
  if (error.status === 429) {
    // Handle rate limiting
    showRateLimitMessage();
  } else if (error.status === 403) {
    // Handle permission error
    showPermissionError();
  } else {
    // Handle other errors
    showGenericError();
  }
}
```

## Support and Feedback

For API support, feature requests, or bug reports, please contact the development team or create an issue in the project repository.

## Changelog

### Version 1.0.0
- Initial release with core matching functionality
- Multi-factor scoring algorithm
- Caching and rate limiting
- Comprehensive test coverage
- Full documentation