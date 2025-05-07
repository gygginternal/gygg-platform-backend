// backend/src/utils/email.js
import nodemailer from 'nodemailer';
import logger from './logger.js'; // Your Winston logger

const sendEmail = async (options) => {
    // 1. Create a transporter (service that will send the email)
    // For testing, Mailtrap.io is excellent. For production: SendGrid, Mailgun, AWS SES etc.
    // Ensure these are in your .env file
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT, // e.g., 587 for TLS, 465 for SSL, 2525 for Mailtrap
        secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD,
        },
        // For services like Gmail, you might need to "allow less secure app access" or use OAuth2
        // For production, use a dedicated transactional email service.
    });

    // 2. Define the email options
    const mailOptions = {
        from: `Gig Platform <${process.env.EMAIL_FROM || 'noreply@gigplatform.com'}>`,
        to: options.email,
        subject: options.subject,
        text: options.message, // Plain text version
        // html: options.html // HTML version (can use templates like EJS)
    };

    // 3. Actually send the email
    try {
        await transporter.sendMail(mailOptions);
        logger.info(`Email sent successfully to ${options.email} for subject: ${options.subject}`);
    } catch (error) {
        logger.error('Error sending email:', { to: options.email, subject: options.subject, error: error.message, stack: error.stack });
        // Do not throw an error here that crashes the main process unless critical.
        // The calling function should handle the email sending failure (e.g., log and continue)
        throw new AppError('There was an error sending the email. Please try again later.', 500); // Or just return false
    }
};

export default sendEmail;