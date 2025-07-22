import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Gig Platform API',
      version: '1.0.0',
      description: 'A comprehensive API for a gig economy platform connecting taskers and providers',
      contact: {
        name: 'API Support',
        email: 'support@gigplatform.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://api.gigplatform.com/api/v1' 
          : `http://localhost:${process.env.PORT || 5000}/api/v1`,
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'jwt',
          description: 'JWT token in cookie'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['error', 'fail']
            },
            message: {
              type: 'string'
            },
            errors: {
              type: 'array',
              items: {
                type: 'string'
              }
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['success']
            },
            message: {
              type: 'string'
            },
            data: {
              type: 'object'
            }
          }
        },
        User: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              format: 'objectId'
            },
            firstName: {
              type: 'string'
            },
            lastName: {
              type: 'string'
            },
            email: {
              type: 'string',
              format: 'email'
            },
            phoneNo: {
              type: 'string',
              pattern: '^\\+\\d{8,15}$'
            },
            role: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['tasker', 'provider', 'admin']
              }
            },
            profileImage: {
              type: 'string'
            },
            bio: {
              type: 'string',
              maxLength: 750
            },
            hobbies: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            skills: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            rating: {
              type: 'number',
              minimum: 0,
              maximum: 5
            },
            ratingCount: {
              type: 'number',
              minimum: 0
            },
            isEmailVerified: {
              type: 'boolean'
            },
            active: {
              type: 'boolean'
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Gig: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              format: 'objectId'
            },
            title: {
              type: 'string'
            },
            description: {
              type: 'string'
            },
            category: {
              type: 'string'
            },
            budget: {
              type: 'number',
              minimum: 0
            },
            location: {
              type: 'object',
              properties: {
                city: { type: 'string' },
                state: { type: 'string' },
                country: { type: 'string' }
              }
            },
            postedBy: {
              $ref: '#/components/schemas/User'
            },
            status: {
              type: 'string',
              enum: ['open', 'in-progress', 'completed', 'cancelled']
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        ChatMessage: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              format: 'objectId'
            },
            conversation: {
              type: 'string',
              format: 'objectId'
            },
            sender: {
              $ref: '#/components/schemas/User'
            },
            receiver: {
              $ref: '#/components/schemas/User'
            },
            content: {
              type: 'string'
            },
            type: {
              type: 'string',
              enum: ['text', 'image', 'file']
            },
            status: {
              type: 'string',
              enum: ['sent', 'delivered', 'read']
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              minimum: 1
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100
            },
            total: {
              type: 'number',
              minimum: 0
            },
            pages: {
              type: 'number',
              minimum: 0
            },
            hasNext: {
              type: 'boolean'
            },
            hasPrev: {
              type: 'boolean'
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                status: 'error',
                message: 'You are not logged in!'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                status: 'error',
                message: 'You do not have permission for this action'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                status: 'error',
                message: 'Resource not found'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                status: 'fail',
                message: 'Invalid input data',
                errors: ['Email is required', 'Password must be at least 8 characters']
              }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      },
      {
        cookieAuth: []
      }
    ]
  },
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
    './src/models/*.js',
    './src/docs/*.js'
  ]
};

const specs = swaggerJsdoc(options);

export { specs, swaggerUi };