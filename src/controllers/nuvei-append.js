});

// --- Nuvei Onboarding Controller Functions ---

// Start Nuvei onboarding process
export const startNuveiOnboarding = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    // Start Nuvei onboarding process through the service
    const result = await nuveiPaymentService.startNuveiOnboarding(userId);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error starting Nuvei onboarding:', error);
    return next(new AppError(`Failed to start Nuvei onboarding: ${error.message}`, 500));
  }
});

// Check Nuvei onboarding status
export const checkNuveiOnboardingStatus = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    // Check Nuvei onboarding status through the service
    const result = await nuveiPaymentService.checkNuveiOnboardingStatus(userId);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error checking Nuvei onboarding status:', error);
    return next(new AppError(`Failed to check Nuvei onboarding status: ${error.message}`, 500));
  }
});

// Set default payment method
export const setDefaultPaymentMethod = catchAsync(async (req, res, next) => {
  const { defaultPaymentMethod } = req.body;
  const userId = req.user.id;
  
  // Validate payment method
  if (!['stripe', 'nuvei'].includes(defaultPaymentMethod)) {
    return next(new AppError("Invalid payment method. Use 'stripe' or 'nuvei'.", 400));
  }
  
  try {
    // Set default payment method through the service
    const result = await nuveiPaymentService.setDefaultPaymentMethod(userId, defaultPaymentMethod);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    return next(new AppError(`Failed to set default payment method: ${error.message}`, 500));
  }
});

// Get all payment methods for user
export const getUserPaymentMethods = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    // Get all payment methods through the service
    const result = await nuveiPaymentService.getUserPaymentMethods(userId);
    
    res.status(200).json({
      status: "success",
      data: result
    });
  } catch (error) {
    console.error('Error getting user payment methods:', error);
    return next(new AppError(`Failed to get payment methods: ${error.message}`, 500));
  }
});