/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: User authentication and authorization
 *   - name: Users
 *     description: User management and profiles
 *   - name: Gigs
 *     description: Gig posting and management
 *   - name: Chat
 *     description: Messaging and chat functionality
 *   - name: Payments
 *     description: Payment processing and Stripe integration
 *   - name: Reviews
 *     description: User reviews and ratings
 *   - name: Notifications
 *     description: User notifications
 *   - name: Admin
 *     description: Administrative functions
 *   - name: Health
 *     description: System health and monitoring
 */

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: System is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                 environment:
 *                   type: string
 *                   example: development
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 */

export default {};