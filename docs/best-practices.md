# Best Practices

This document provides guidelines and best practices for building robust, maintainable workflows with Aiki.

## Workflow Design

### 1. Keep Workflows Focused

Design workflows to handle a single business process:

```typescript
// ✅ Good: Focused workflow
const userOnboardingWorkflow = workflow({
  name: "user-onboarding",
  version: "1.0.0",
  async run({ workflowRun }) {
    await validateUser.run(workflowRun, { payload: workflowRun.params.payload });
    await sendWelcomeEmail.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
    await createUserProfile.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
  }
});

// ❌ Bad: Too many responsibilities
const megaWorkflow = workflow({
  name: "do-everything",
  version: "1.0.0",
  async run({ workflowRun }) {
    // User management
    await validateUser.run(workflowRun, { payload: workflowRun.params.payload });
    await sendWelcomeEmail.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
    
    // Order processing
    await processOrder.run(workflowRun, { payload: workflowRun.params.payload.order });
    await sendOrderConfirmation.run(workflowRun, { payload: { orderId: workflowRun.params.payload.order.id } });
    
    // Payment processing
    await processPayment.run(workflowRun, { payload: workflowRun.params.payload.payment });
    
    // Inventory management
    await updateInventory.run(workflowRun, { payload: workflowRun.params.payload.order.items });
  }
});
```

### 2. Use Meaningful Names

Choose descriptive names for workflows and tasks:

```typescript
// ✅ Good: Descriptive names
const processOrderPaymentWorkflow = workflow({
  name: "process-order-payment",
  version: "1.0.0",
  // ...
});

const validatePaymentMethod = task({
  name: "validate-payment-method",
  // ...
});

// ❌ Bad: Generic names
const workflow1 = workflow({
  name: "workflow1",
  version: "1.0.0",
  // ...
});

const task1 = task({
  name: "task1",
  // ...
});
```

### 3. Version Your Workflows

Use semantic versioning for workflow updates:

```typescript
// Version 1.0.0 - Initial implementation
const userOnboardingV1 = workflow({
  name: "user-onboarding",
  version: "1.0.0",
  async run({ workflowRun }) {
    await sendWelcomeEmail.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
  }
});

// Version 1.1.0 - Add profile creation
const userOnboardingV11 = workflow({
  name: "user-onboarding",
  version: "1.1.0",
  async run({ workflowRun }) {
    await sendWelcomeEmail.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
    await createUserProfile.run(workflowRun, { payload: { userId: workflowRun.params.payload.userId } });
  }
});

// Version 2.0.0 - Breaking changes
const userOnboardingV2 = workflow({
  name: "user-onboarding",
  version: "2.0.0",
  async run({ workflowRun }) {
    // New implementation with different payload structure
    await sendWelcomeEmail.run(workflowRun, { payload: { email: workflowRun.params.payload.email } });
    await createUserProfile.run(workflowRun, { payload: { email: workflowRun.params.payload.email } });
  }
});
```

## Task Design

### 1. Make Tasks Atomic

Each task should perform a single, well-defined operation:

```typescript
// ✅ Good: Atomic tasks
const validateUser = task({
  name: "validate-user",
  run({ payload }) {
    return validateUserData(payload.userData);
  }
});

const sendWelcomeEmail = task({
  name: "send-welcome-email",
  run({ payload }) {
    return sendEmail(payload.email, welcomeTemplate);
  }
});

// ❌ Bad: Complex task with multiple responsibilities
const processUserRegistration = task({
  name: "process-user-registration",
  run({ payload }) {
    // Too many responsibilities
    const validation = validateUserData(payload.userData);
    if (!validation.valid) throw new Error("Invalid user data");
    
    const user = createUser(payload.userData);
    sendEmail(user.email, welcomeTemplate);
    createUserProfile(user.id);
    
    return user;
  }
});
```

### 2. Handle Errors Gracefully

Implement proper error handling in tasks:

```typescript
const processPayment = task({
  name: "process-payment",
  run({ payload }) {
    try {
      return processPaymentWithId(payload.paymentId, payload.amount);
    } catch (error) {
      // Log error for debugging
      console.error(`Payment processing failed for ${payload.paymentId}:`, error);
      
      // Return structured error information
      return {
        success: false,
        error: error.message,
        paymentId: payload.paymentId
      };
    }
  },
  retry: {
    type: "exponential",
    maxAttempts: 3,
    baseDelayMs: 1000
  }
});
```

### 3. Use Appropriate Retry Strategies

Choose retry strategies based on the task characteristics:

```typescript
// Fixed delay for simple operations
const simpleTask = task({
  name: "simple-task",
  retry: {
    type: "fixed",
    maxAttempts: 3,
    delayMs: 1000
  }
});

// Exponential backoff for external API calls
const apiTask = task({
  name: "api-task",
  retry: {
    type: "exponential",
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000
  }
});

// Jittered backoff for high-concurrency scenarios
const highConcurrencyTask = task({
  name: "high-concurrency-task",
  retry: {
    type: "jittered",
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000
  }
});
```

## Error Handling

### 1. Workflow-Level Error Handling

Handle errors at the workflow level:

```typescript
const orderProcessingWorkflow = workflow({
  name: "order-processing",
  version: "1.0.0",
  async run({ workflowRun }) {
    try {
      // Validate order
      const validation = await validateOrder.run(workflowRun, {
        payload: workflowRun.params.payload
      });
      
      if (!validation.valid) {
        throw new Error(`Order validation failed: ${validation.reason}`);
      }
      
      // Process payment
      const payment = await processPayment.run(workflowRun, {
        payload: { orderId: validation.orderId, amount: validation.amount }
      });
      
      if (!payment.success) {
        throw new Error(`Payment failed: ${payment.error}`);
      }
      
      // Send confirmation
      await sendOrderConfirmation.run(workflowRun, {
        payload: { orderId: validation.orderId, email: workflowRun.params.payload.email }
      });
      
      return { success: true, orderId: validation.orderId };
      
    } catch (error) {
      // Log error
      console.error(`Order processing failed:`, error);
      
      // Send failure notification
      await sendFailureNotification.run(workflowRun, {
        payload: { 
          orderId: workflowRun.params.payload.orderId,
          error: error.message 
        }
      });
      
      // Re-throw to mark workflow as failed
      throw error;
    }
  }
});
```

### 2. Task-Level Error Handling

Handle errors within individual tasks:

```typescript
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    try {
      const result = sendEmailToUser(payload.email, payload.template);
      
      // Log success
      console.log(`Email sent successfully to ${payload.email}`);
      
      return { success: true, emailId: result.id };
      
    } catch (error) {
      // Log error with context
      console.error(`Failed to send email to ${payload.email}:`, error);
      
      // Return structured error
      return {
        success: false,
        error: error.message,
        email: payload.email
      };
    }
  }
});
```

## Performance Optimization

### 1. Use Idempotency Keys

Implement idempotency for expensive operations:

```typescript
const fetchUserData = task({
  name: "fetch-user-data",
  run({ payload, workflowRun }) {
    const idempotencyKey = `user-data-${payload.userId}`;
    
    // Check if we already have this data
    const existing = await getCachedUserData(idempotencyKey);
    if (existing) {
      return existing;
    }
    
    // Fetch from external API
    const userData = await fetchFromExternalAPI(payload.userId);
    
    // Cache the result
    await cacheUserData(idempotencyKey, userData);
    
    return userData;
  }
});
```

### 2. Batch Operations

Group related operations when possible:

```typescript
const processMultipleOrders = task({
  name: "process-multiple-orders",
  run({ payload }) {
    const { orderIds } = payload;
    
    // Process orders in batch
    return Promise.all(
      orderIds.map(orderId => processSingleOrder(orderId))
    );
  }
});
```

### 3. Optimize Worker Configuration

Configure workers for optimal performance:

```typescript
const workerInstance = await worker(client, {
  id: "high-performance-worker",
  
  // Adjust concurrency based on task characteristics
  maxConcurrentWorkflowRuns: 10,
  
  // Optimize polling for your workload
  workflowRunSubscriber: {
    pollIntervalMs: 50,        // Faster polling for high-priority workflows
    maxBatchSize: 20,          // Larger batches for efficiency
    maxRetryDelayMs: 15000     // Shorter retry delays
  },
  
  // Configure heartbeat for monitoring
  workflowRun: {
    heartbeatIntervalMs: 15000 // More frequent heartbeats
  },
  
  // Graceful shutdown
  gracefulShutdownTimeoutMs: 10000
});
```

## Monitoring and Observability

### 1. Add Logging

Include comprehensive logging in your workflows and tasks:

```typescript
const orderWorkflow = workflow({
  name: "order-processing",
  version: "1.0.0",
  async run({ workflowRun }) {
    console.log(`Starting order processing for workflow ${workflowRun.id}`);
    
    const validation = await validateOrder.run(workflowRun, {
      payload: workflowRun.params.payload
    });
    
    console.log(`Order validation completed: ${validation.valid}`);
    
    const payment = await processPayment.run(workflowRun, {
      payload: { orderId: validation.orderId, amount: validation.amount }
    });
    
    console.log(`Payment processing completed: ${payment.success}`);
    
    console.log(`Order processing completed for workflow ${workflowRun.id}`);
    
    return { success: true, orderId: validation.orderId };
  }
});
```

### 2. Add Metrics

Track important metrics for monitoring:

```typescript
const processPayment = task({
  name: "process-payment",
  run({ payload }) {
    const startTime = Date.now();
    
    try {
      const result = processPaymentWithId(payload.paymentId, payload.amount);
      
      // Track success metrics
      recordMetric("payment_success", 1);
      recordMetric("payment_duration", Date.now() - startTime);
      
      return result;
      
    } catch (error) {
      // Track failure metrics
      recordMetric("payment_failure", 1);
      recordMetric("payment_duration", Date.now() - startTime);
      
      throw error;
    }
  }
});
```

### 3. Implement Health Checks

Add health checks to your workers:

```typescript
const workerInstance = await worker(client, {
  id: "monitored-worker",
  // ... other config
});

// Add health check endpoint
app.get("/health", (req, res) => {
  const health = {
    status: "healthy",
    workerId: workerInstance.id,
    activeWorkflows: workerInstance.getActiveWorkflowCount(),
    uptime: process.uptime()
  };
  
  res.json(health);
});
```

## Security Best Practices

### 1. Validate Input

Always validate input data in tasks:

```typescript
const processUserData = task({
  name: "process-user-data",
  run({ payload }) {
    // Validate input
    if (!payload.userId || typeof payload.userId !== "string") {
      throw new Error("Invalid userId provided");
    }
    
    if (!payload.email || !isValidEmail(payload.email)) {
      throw new Error("Invalid email provided");
    }
    
    // Process validated data
    return processValidatedUserData(payload);
  }
});
```

### 2. Sanitize Output

Sanitize data before returning from tasks:

```typescript
const getUserProfile = task({
  name: "get-user-profile",
  run({ payload }) {
    const userProfile = fetchUserProfileFromDatabase(payload.userId);
    
    // Sanitize sensitive data
    return {
      id: userProfile.id,
      name: userProfile.name,
      email: userProfile.email,
      // Don't return password, SSN, etc.
    };
  }
});
```

### 3. Use Environment Variables

Store sensitive configuration in environment variables:

```typescript
const sendEmail = task({
  name: "send-email",
  run({ payload }) {
    const emailConfig = {
      apiKey: process.env.EMAIL_API_KEY,
      fromAddress: process.env.EMAIL_FROM_ADDRESS,
      baseUrl: process.env.EMAIL_SERVICE_URL
    };
    
    return sendEmailWithConfig(payload.email, payload.content, emailConfig);
  }
});
```

## Testing Best Practices

### 1. Unit Test Tasks

Write unit tests for individual tasks:

```typescript
describe("calculateTax task", () => {
  it("should calculate tax correctly", async () => {
    const payload = { amount: 100, taxRate: 0.1 };
    const result = await calculateTax.run(mockWorkflowRun, { payload });
    
    expect(result).toEqual({ tax: 10, total: 110 });
  });
  
  it("should handle zero amount", async () => {
    const payload = { amount: 0, taxRate: 0.1 };
    const result = await calculateTax.run(mockWorkflowRun, { payload });
    
    expect(result).toEqual({ tax: 0, total: 0 });
  });
});
```

### 2. Integration Test Workflows

Test complete workflow execution:

```typescript
describe("order processing workflow", () => {
  it("should process order successfully", async () => {
    const orderData = { orderId: "123", amount: 100, email: "user@example.com" };
    
    const resultHandle = await orderWorkflow.enqueue(client, { payload: orderData });
    const result = await resultHandle.waitForCompletion();
    
    expect(result.success).toBe(true);
    expect(result.orderId).toBe("123");
  });
  
  it("should handle validation failures", async () => {
    const invalidOrderData = { orderId: "", amount: -100, email: "invalid-email" };
    
    const resultHandle = await orderWorkflow.enqueue(client, { payload: invalidOrderData });
    
    await expect(resultHandle.waitForCompletion()).rejects.toThrow();
  });
});
```

### 3. Test Error Scenarios

Test how workflows handle errors:

```typescript
describe("payment processing workflow", () => {
  it("should retry failed payments", async () => {
    // Mock payment service to fail first two attempts
    let attemptCount = 0;
    mockPaymentService.mockImplementation(() => {
      attemptCount++;
      if (attemptCount <= 2) {
        throw new Error("Payment service temporarily unavailable");
      }
      return { success: true };
    });
    
    const resultHandle = await paymentWorkflow.enqueue(client, { 
      payload: { paymentId: "123", amount: 100 } 
    });
    const result = await resultHandle.waitForCompletion();
    
    expect(result.success).toBe(true);
    expect(attemptCount).toBe(3);
  });
});
```

## Deployment Best Practices

### 1. Use Environment-Specific Configuration

Configure workers for different environments:

```typescript
const config = {
  development: {
    maxConcurrentWorkflowRuns: 2,
    pollIntervalMs: 1000,
    heartbeatIntervalMs: 60000
  },
  staging: {
    maxConcurrentWorkflowRuns: 5,
    pollIntervalMs: 500,
    heartbeatIntervalMs: 30000
  },
  production: {
    maxConcurrentWorkflowRuns: 20,
    pollIntervalMs: 100,
    heartbeatIntervalMs: 15000
  }
};

const workerInstance = await worker(client, {
  id: `worker-${process.env.NODE_ENV}`,
  ...config[process.env.NODE_ENV]
});
```

### 2. Implement Graceful Shutdown

Handle worker shutdown properly:

```typescript
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  
  await workerInstance.stop();
  
  console.log("Worker stopped gracefully");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT, shutting down gracefully...");
  
  await workerInstance.stop();
  
  console.log("Worker stopped gracefully");
  process.exit(0);
});
```

### 3. Use Health Checks

Implement health checks for monitoring:

```typescript
const healthCheck = {
  status: "healthy",
  timestamp: new Date().toISOString(),
  worker: {
    id: workerInstance.id,
    activeWorkflows: workerInstance.getActiveWorkflowCount(),
    uptime: process.uptime()
  },
  system: {
    memory: process.memoryUsage(),
    cpu: process.cpuUsage()
  }
};

// Expose health check endpoint
app.get("/health", (req, res) => {
  res.json(healthCheck);
});
```

## Summary

Following these best practices will help you build robust, maintainable, and scalable workflows with Aiki:

1. **Design focused workflows** with clear responsibilities
2. **Make tasks atomic** and handle errors gracefully
3. **Use appropriate retry strategies** for different task types
4. **Implement comprehensive error handling** at both workflow and task levels
5. **Optimize performance** with idempotency keys and batching
6. **Add monitoring and observability** with logging and metrics
7. **Follow security best practices** for input validation and data sanitization
8. **Write comprehensive tests** for tasks and workflows
9. **Configure deployments** appropriately for different environments
10. **Implement graceful shutdown** and health checks

These practices will ensure your workflows are reliable, maintainable, and performant in production environments. 