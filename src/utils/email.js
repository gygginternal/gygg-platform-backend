import nodemailer from 'nodemailer';
import logger from './logger.js'; // Your Winston logger

const sendEmail = async (options) => {
    // 1. Create a transporter
    let transporter;
    if (process.env.NODE_ENV === 'production' || (process.env.EMAIL_HOST && process.env.EMAIL_USERNAME)) {
        // For production or configured Gmail SMTP
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT, 10),
            secure: process.env.EMAIL_PORT === '465', // true for 465 (SSL), false for 587 (TLS)
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD, // Use App Password here
            },
            // Optional: for some environments or strict TLS
            // tls: {
            //     ciphers:'SSLv3' // Or rejectUnauthorized: false (less secure)
            // }
        });
    } else {
        // Fallback to Mailtrap or console for development if Gmail not configured
        logger.warn("Gmail SMTP not fully configured. Using fallback email transport (console or Mailtrap).");
        // Example Mailtrap (if you uncomment and set Mailtrap env vars)
        /*
        transporter = nodemailer.createTransport({
            host: process.env.MAILTRAP_HOST, // e.g., sandbox.smtp.mailtrap.io
            port: parseInt(process.env.MAILTRAP_PORT, 10), // e.g., 2525
            auth: {
                user: process.env.MAILTRAP_USERNAME,
                pass: process.env.MAILTRAP_PASSWORD,
            },
        });
        */
       // Default fallback to console to avoid crashes
        transporter = {
            sendMail: async (mailOpts) => {
                logger.info('--- SIMULATED EMAIL (Transport not configured) ---');
                logger.info('To:', mailOpts.to);
                logger.info('From:', mailOpts.from);
                logger.info('Subject:', mailOpts.subject);
                logger.info('Text Body:', mailOpts.text);
                if (mailOpts.html) logger.info('HTML Body:', mailOpts.html);
                logger.info('--------------------------------------------------');
                return Promise.resolve({ messageId: `simulated-${Date.now()}`});
            }
        };
    }


    // 2. Define the email options
    const mailOptions = {
        from: process.env.EMAIL_FROM || `Gygg Platform <noreply@example.com>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html || `<p>${options.message.replace(/\n/g, "<br>")}</p>` // Basic HTML version
    };

    // 3. Actually send the email
    try {
        const info = await transporter.sendMail(mailOptions);
        logger.info(`Email sent successfully to ${options.email} for subject: "${options.subject}". Message ID: ${info.messageId}`);
        return true; // Indicate success
    } catch (error) {
        logger.error('Error sending email:', {
            to: options.email,
            subject: options.subject,
            errorMessage: error.message,
            // stack: error.stack // Stack might be too verbose for regular logs
        });
        // Do not re-throw the original error to crash the main process for non-critical email failure
        // The calling function should handle this potential failure.
        // throw new AppError('There was an error sending the email. Please try again later.', 500);
        return false; // Indicate failure
    }
};

export default sendEmail;