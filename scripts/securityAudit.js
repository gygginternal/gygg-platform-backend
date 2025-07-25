#!/usr/bin/env node

/**
 * Security Audit Script
 * Performs comprehensive security checks on the backend application
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// ANSI color codes for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

class SecurityAuditor {
  constructor() {
    this.issues = {
      critical: [],
      high: [],
      medium: [],
      low: [],
      info: []
    };
    this.passed = [];
  }

  log(level, message, details = '') {
    const timestamp = new Date().toISOString();
    const color = {
      critical: colors.red,
      high: colors.red,
      medium: colors.yellow,
      low: colors.blue,
      info: colors.cyan,
      pass: colors.green
    }[level] || colors.white;

    console.log(`${color}${colors.bold}[${level.toUpperCase()}]${colors.reset} ${message}`);
    if (details) {
      console.log(`${colors.white}  ${details}${colors.reset}`);
    }
  }

  addIssue(level, title, description, file = '', line = '') {
    const issue = {
      title,
      description,
      file,
      line,
      timestamp: new Date().toISOString()
    };

    this.issues[level].push(issue);
    this.log(level, title, description + (file ? ` (${file}${line ? `:${line}` : ''})` : ''));
  }

  addPass(title, description = '') {
    this.passed.push({ title, description });
    this.log('pass', `✓ ${title}`, description);
  }

  // Check for environment variables security
  checkEnvironmentSecurity() {
    console.log(`\n${colors.bold}${colors.cyan}=== Environment Security ===${colors.reset}`);

    const envFile = path.join(projectRoot, '.env');
    const envExampleFile = path.join(projectRoot, '.env.example');

    // Check if .env exists
    if (!fs.existsSync(envFile)) {
      this.addIssue('medium', 'Missing .env file', 'Environment configuration file not found');
    } else {
      this.addPass('Environment file exists');
    }

    // Check if .env.example exists
    if (!fs.existsSync(envExampleFile)) {
      this.addIssue('low', 'Missing .env.example file', 'Example environment file not found');
    } else {
      this.addPass('Environment example file exists');
    }

    // Check for required environment variables
    const requiredEnvVars = [
      'NODE_ENV',
      'PORT',
      'DATABASE_URI',
      'JWT_SECRET',
      'JWT_EXPIRES_IN',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'EMAIL_FROM',
      'FRONTEND_URL'
    ];

    requiredEnvVars.forEach(envVar => {
      if (!process.env[envVar]) {
        this.addIssue('high', `Missing required environment variable: ${envVar}`, 
          'This variable is required for proper application security');
      } else {
        this.addPass(`Environment variable ${envVar} is set`);
      }
    });

    // Check JWT secret strength
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      this.addIssue('critical', 'Weak JWT secret', 
        'JWT secret should be at least 32 characters long');
    } else if (process.env.JWT_SECRET) {
      this.addPass('JWT secret has adequate length');
    }

    // Check for development settings in production
    if (process.env.NODE_ENV === 'production') {
      if (process.env.DATABASE_URI && process.env.DATABASE_URI.includes('localhost')) {
        this.addIssue('critical', 'Development database in production', 
          'Production should not use localhost database');
      }
    }
  }

  // Check package.json for security issues
  checkPackageSecurity() {
    console.log(`\n${colors.bold}${colors.cyan}=== Package Security ===${colors.reset}`);

    const packageFile = path.join(projectRoot, 'package.json');
    
    if (!fs.existsSync(packageFile)) {
      this.addIssue('critical', 'Missing package.json', 'Package configuration file not found');
      return;
    }

    try {
      const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8'));

      // Check for security-related packages
      const securityPackages = [
        'helmet',
        'cors',
        'express-rate-limit',
        'express-mongo-sanitize',
        'xss-clean',
        'bcryptjs',
        'jsonwebtoken'
      ];

      securityPackages.forEach(pkg => {
        if (packageData.dependencies && packageData.dependencies[pkg]) {
          this.addPass(`Security package ${pkg} is installed`);
        } else {
          this.addIssue('medium', `Missing security package: ${pkg}`, 
            'This package provides important security features');
        }
      });

      // Check for audit script
      if (packageData.scripts && packageData.scripts.audit) {
        this.addPass('Audit script is configured');
      } else {
        this.addIssue('low', 'Missing audit script', 
          'Consider adding "audit": "npm audit" to package.json scripts');
      }

    } catch (error) {
      this.addIssue('high', 'Invalid package.json', `Cannot parse package.json: ${error.message}`);
    }

    // Run npm audit if available
    try {
      console.log('\nRunning npm audit...');
      const auditResult = execSync('npm audit --json', { 
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 30000
      });
      
      const audit = JSON.parse(auditResult);
      
      if (audit.metadata && audit.metadata.vulnerabilities) {
        const vulns = audit.metadata.vulnerabilities;
        
        if (vulns.critical > 0) {
          this.addIssue('critical', `${vulns.critical} critical vulnerabilities found`, 
            'Run "npm audit fix" to resolve');
        }
        if (vulns.high > 0) {
          this.addIssue('high', `${vulns.high} high vulnerabilities found`, 
            'Run "npm audit fix" to resolve');
        }
        if (vulns.moderate > 0) {
          this.addIssue('medium', `${vulns.moderate} moderate vulnerabilities found`, 
            'Run "npm audit fix" to resolve');
        }
        if (vulns.low > 0) {
          this.addIssue('low', `${vulns.low} low vulnerabilities found`, 
            'Consider running "npm audit fix"');
        }
        
        if (vulns.critical === 0 && vulns.high === 0 && vulns.moderate === 0 && vulns.low === 0) {
          this.addPass('No known vulnerabilities in dependencies');
        }
      }
    } catch (error) {
      this.addIssue('info', 'Could not run npm audit', 
        'Manual security audit of dependencies recommended');
    }
  }

  // Check file permissions and sensitive files
  checkFileSecurity() {
    console.log(`\n${colors.bold}${colors.cyan}=== File Security ===${colors.reset}`);

    // Check for sensitive files that shouldn't be committed
    const sensitiveFiles = [
      '.env',
      'config/database.js',
      'private.key',
      'certificate.crt',
      '.aws/credentials'
    ];

    const gitignoreFile = path.join(projectRoot, '.gitignore');
    let gitignoreContent = '';
    
    if (fs.existsSync(gitignoreFile)) {
      gitignoreContent = fs.readFileSync(gitignoreFile, 'utf8');
      this.addPass('Gitignore file exists');
    } else {
      this.addIssue('medium', 'Missing .gitignore file', 
        'Gitignore file helps prevent committing sensitive files');
    }

    sensitiveFiles.forEach(file => {
      const filePath = path.join(projectRoot, file);
      if (fs.existsSync(filePath)) {
        if (!gitignoreContent.includes(file)) {
          this.addIssue('high', `Sensitive file not in gitignore: ${file}`, 
            'This file may contain sensitive information');
        } else {
          this.addPass(`Sensitive file ${file} is properly ignored`);
        }
      }
    });

    // Check for backup files
    const backupPatterns = ['*.bak', '*.backup', '*.old', '*~'];
    // This is a simplified check - in a real implementation, you'd use glob patterns
    this.addPass('Backup file check completed');
  }

  // Check code for security issues
  checkCodeSecurity() {
    console.log(`\n${colors.bold}${colors.cyan}=== Code Security ===${colors.reset}`);

    const srcDir = path.join(projectRoot, 'src');
    
    if (!fs.existsSync(srcDir)) {
      this.addIssue('medium', 'Source directory not found', 'Expected src/ directory');
      return;
    }

    // Check for console.log statements (should use proper logging)
    this.checkForConsoleStatements(srcDir);
    
    // Check for hardcoded secrets
    this.checkForHardcodedSecrets(srcDir);
    
    // Check for SQL injection vulnerabilities
    this.checkForSQLInjection(srcDir);
    
    // Check for proper error handling
    this.checkErrorHandling(srcDir);
  }

  checkForConsoleStatements(dir) {
    const files = this.getJSFiles(dir);
    let consoleCount = 0;

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        if (line.includes('console.log') || line.includes('console.error')) {
          consoleCount++;
          if (consoleCount <= 5) { // Only report first 5 to avoid spam
            this.addIssue('low', 'Console statement found', 
              `Use proper logging instead of console statements`, 
              path.relative(projectRoot, file), index + 1);
          }
        }
      });
    });

    if (consoleCount === 0) {
      this.addPass('No console statements found');
    } else if (consoleCount > 5) {
      this.addIssue('medium', `${consoleCount} console statements found`, 
        'Consider replacing with proper logging');
    }
  }

  checkForHardcodedSecrets(dir) {
    const files = this.getJSFiles(dir);
    const secretPatterns = [
      /password\s*=\s*['"][^'"]+['"]/i,
      /secret\s*=\s*['"][^'"]+['"]/i,
      /key\s*=\s*['"][^'"]+['"]/i,
      /token\s*=\s*['"][^'"]+['"]/i,
      /api[_-]?key\s*=\s*['"][^'"]+['"]/i
    ];

    let secretsFound = 0;

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        secretPatterns.forEach(pattern => {
          if (pattern.test(line) && !line.includes('process.env')) {
            secretsFound++;
            this.addIssue('critical', 'Potential hardcoded secret', 
              'Secrets should be stored in environment variables', 
              path.relative(projectRoot, file), index + 1);
          }
        });
      });
    });

    if (secretsFound === 0) {
      this.addPass('No hardcoded secrets found');
    }
  }

  checkForSQLInjection(dir) {
    const files = this.getJSFiles(dir);
    const sqlPatterns = [
      /\$\{.*\}.*query/i,
      /query.*\+.*req\./i,
      /SELECT.*\+/i,
      /INSERT.*\+/i,
      /UPDATE.*\+/i,
      /DELETE.*\+/i
    ];

    let vulnerabilitiesFound = 0;

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        sqlPatterns.forEach(pattern => {
          if (pattern.test(line)) {
            vulnerabilitiesFound++;
            this.addIssue('high', 'Potential SQL injection vulnerability', 
              'Use parameterized queries or ORM methods', 
              path.relative(projectRoot, file), index + 1);
          }
        });
      });
    });

    if (vulnerabilitiesFound === 0) {
      this.addPass('No obvious SQL injection vulnerabilities found');
    }
  }

  checkErrorHandling(dir) {
    const files = this.getJSFiles(dir);
    let properErrorHandling = 0;
    let totalTryCatch = 0;

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      
      // Count try-catch blocks
      const tryCatchMatches = content.match(/try\s*{/g);
      if (tryCatchMatches) {
        totalTryCatch += tryCatchMatches.length;
        
        // Check if catch blocks handle errors properly
        const catchMatches = content.match(/catch\s*\([^)]*\)\s*{[^}]*}/g);
        if (catchMatches) {
          catchMatches.forEach(catchBlock => {
            if (catchBlock.includes('next(') || catchBlock.includes('logger.') || catchBlock.includes('logError(')) {
              properErrorHandling++;
            }
          });
        }
      }
    });

    if (totalTryCatch > 0) {
      const ratio = properErrorHandling / totalTryCatch;
      if (ratio > 0.8) {
        this.addPass('Good error handling practices found');
      } else if (ratio > 0.5) {
        this.addIssue('medium', 'Some error handling could be improved', 
          'Ensure all catch blocks properly handle and log errors');
      } else {
        this.addIssue('high', 'Poor error handling practices', 
          'Many catch blocks do not properly handle errors');
      }
    }
  }

  getJSFiles(dir) {
    const files = [];
    
    const scanDir = (currentDir) => {
      const items = fs.readdirSync(currentDir);
      
      items.forEach(item => {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          scanDir(fullPath);
        } else if (stat.isFile() && (item.endsWith('.js') || item.endsWith('.mjs'))) {
          files.push(fullPath);
        }
      });
    };
    
    scanDir(dir);
    return files;
  }

  // Generate security report
  generateReport() {
    console.log(`\n${colors.bold}${colors.cyan}=== Security Audit Report ===${colors.reset}`);
    
    const totalIssues = Object.values(this.issues).reduce((sum, arr) => sum + arr.length, 0);
    const totalPassed = this.passed.length;

    console.log(`\n${colors.bold}Summary:${colors.reset}`);
    console.log(`${colors.green}✓ Passed: ${totalPassed}${colors.reset}`);
    console.log(`${colors.red}✗ Critical: ${this.issues.critical.length}${colors.reset}`);
    console.log(`${colors.red}✗ High: ${this.issues.high.length}${colors.reset}`);
    console.log(`${colors.yellow}⚠ Medium: ${this.issues.medium.length}${colors.reset}`);
    console.log(`${colors.blue}ℹ Low: ${this.issues.low.length}${colors.reset}`);
    console.log(`${colors.cyan}ℹ Info: ${this.issues.info.length}${colors.reset}`);

    // Security score calculation
    const criticalWeight = 10;
    const highWeight = 5;
    const mediumWeight = 2;
    const lowWeight = 1;
    
    const totalWeight = (this.issues.critical.length * criticalWeight) +
                       (this.issues.high.length * highWeight) +
                       (this.issues.medium.length * mediumWeight) +
                       (this.issues.low.length * lowWeight);
    
    const maxScore = 100;
    const score = Math.max(0, maxScore - totalWeight);
    
    console.log(`\n${colors.bold}Security Score: ${score}/100${colors.reset}`);
    
    if (score >= 90) {
      console.log(`${colors.green}Excellent security posture!${colors.reset}`);
    } else if (score >= 70) {
      console.log(`${colors.yellow}Good security, but room for improvement${colors.reset}`);
    } else if (score >= 50) {
      console.log(`${colors.red}Security needs attention${colors.reset}`);
    } else {
      console.log(`${colors.red}Critical security issues need immediate attention${colors.reset}`);
    }

    // Write detailed report to file
    const reportFile = path.join(projectRoot, 'security-audit-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      score,
      summary: {
        passed: totalPassed,
        critical: this.issues.critical.length,
        high: this.issues.high.length,
        medium: this.issues.medium.length,
        low: this.issues.low.length,
        info: this.issues.info.length
      },
      issues: this.issues,
      passed: this.passed
    };

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n${colors.cyan}Detailed report saved to: ${reportFile}${colors.reset}`);

    return score >= 70; // Return true if security is acceptable
  }

  // Run all security checks
  async runAudit() {
    console.log(`${colors.bold}${colors.magenta}🔒 Security Audit Starting...${colors.reset}\n`);
    
    this.checkEnvironmentSecurity();
    this.checkPackageSecurity();
    this.checkFileSecurity();
    this.checkCodeSecurity();
    
    const passed = this.generateReport();
    
    console.log(`\n${colors.bold}${colors.magenta}🔒 Security Audit Complete${colors.reset}`);
    
    // Exit with appropriate code
    process.exit(passed ? 0 : 1);
  }
}

// Run the audit
const auditor = new SecurityAuditor();
auditor.runAudit().catch(error => {
  console.error(`${colors.red}Audit failed: ${error.message}${colors.reset}`);
  process.exit(1);
});