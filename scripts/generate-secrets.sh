#!/bin/bash
# Production Setup Helper Script
# Generates secure secrets and validates configuration

echo "🔐 Turf Booking System - Production Setup Helper"
echo "=================================================="
echo ""

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    echo "❌ Error: openssl is not installed"
    echo "   Please install openssl to generate secure secrets"
    exit 1
fi

echo "✅ Generating secure secrets..."
echo ""

# Generate JWT secrets
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
JWT_REFRESH_SECRET=$(openssl rand -base64 64 | tr -d '\n')
MANAGER_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')

echo "📝 Copy these secrets to your .env file or hosting platform:"
echo ""
echo "# =========================================="
echo "# GENERATED SECRETS - KEEP THESE SAFE!"
echo "# Generated on: $(date)"
echo "# =========================================="
echo ""
echo "JWT_SECRET=$JWT_SECRET"
echo ""
echo "JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET"
echo ""
echo "MANAGER_PASSWORD=$MANAGER_PASSWORD"
echo ""
echo "# =========================================="
echo ""

# Save to file (optional)
read -p "💾 Save to production-secrets.txt? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cat > production-secrets.txt << EOF
# ==========================================
# TURF BOOKING SYSTEM - PRODUCTION SECRETS
# Generated on: \$(date)
# ==========================================
# 
# ⚠️  CRITICAL: Keep this file secure!
# - Never commit to version control
# - Store in secure password manager
# - Delete after copying to production
# 
# ==========================================

JWT_SECRET=$JWT_SECRET

JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET

MANAGER_PASSWORD=$MANAGER_PASSWORD

# ==========================================
# DEPLOYMENT CHECKLIST
# ==========================================
# [ ] Copy secrets to hosting platform
# [ ] Set NODE_ENV=production
# [ ] Configure DATABASE (MongoDB Atlas)
# [ ] Set up EMAIL_SERVICE (Resend)
# [ ] Configure CLOUDINARY
# [ ] Set up SSLCOMMERZ
# [ ] Enable HTTPS (SECURE_COOKIES=true)
# [ ] Configure CORS_ORIGINS
# [ ] Test health endpoint
# [ ] Setup monitoring
# ==========================================
EOF
    echo "✅ Secrets saved to: production-secrets.txt"
    echo "⚠️  Remember to delete this file after use!"
else
    echo "ℹ️  Secrets not saved. Copy them from above."
fi

echo ""
echo "📋 Next Steps:"
echo "   1. Copy the generated secrets to your hosting platform"
echo "   2. Review PRODUCTION_DEPLOYMENT.md for full setup"
echo "   3. Complete the environment configuration"
echo "   4. Test in staging before production"
echo ""
echo "🔗 Resources:"
echo "   - Deployment Guide: ./PRODUCTION_DEPLOYMENT.md"
echo "   - Environment Example: ./.env.example"
echo "   - Improvements Doc: ./PRODUCTION_IMPROVEMENTS.md"
echo ""
echo "✨ Setup complete! Good luck with your deployment!"
