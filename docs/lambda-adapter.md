# Lambda adapter

The lambda adapter turns AWS Lambda functions into searchable, callable SDK methods. Two modes: manifest file (you define the schemas) or AWS discovery (it reads them from your account).

## Manifest file mode

Best when you want control over which functions are exposed and how they're typed.

Create a JSON file listing your functions:

```json
{
  "region": "us-east-1",
  "functions": [
    {
      "functionName": "myapp-payments-processPayment",
      "description": "Process a credit card payment",
      "input": {
        "amount": { "type": "number", "required": true, "description": "Amount in cents" },
        "currency": { "type": "string", "required": false }
      },
      "output": "{ transactionId: string; status: 'success' | 'failed' }",
      "readOnly": false
    },
    {
      "functionName": "myapp-payments-getTransaction",
      "description": "Look up a transaction by ID",
      "input": {
        "transactionId": { "type": "string", "required": true }
      },
      "output": "{ transactionId: string; amount: number; status: string }",
      "readOnly": true
    }
  ]
}
```

Then point your config at it:

```javascript
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'payments',
      adapter: 'lambda',
      source: './lambda-manifest.json',
    },
  ],
};
```

Claude sees typed methods like `sdk.payments.processPayment({ amount, currency })` and `sdk.payments.getTransaction({ transactionId })`. codemode-x calls `Lambda.invoke()` with the params as the payload.

## AWS discovery mode

If you don't want to maintain a manifest, the adapter can scan your AWS account. Pass the region as the source:

```javascript
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'payments',
      adapter: 'lambda',
      source: 'us-east-1',
    },
  ],
};
```

This calls `ListFunctions` and reads each function's tags for schema information.

### Tagging convention

Add these tags to your Lambda functions so the adapter knows what they accept and return:

| Tag | What it does | Example |
|-----|-------------|---------|
| `cmx:input` | JSON object mapping param names to `{ type, required, description }` | `{"amount":{"type":"number","required":true}}` |
| `cmx:output` | TypeScript type string for the return value | `{ transactionId: string }` |
| `cmx:readonly` | Set to `"true"` for read-only functions | `true` |
| `cmx:exclude` | Set to `"true"` to hide a function from the SDK | `true` |

Functions without a `cmx:input` tag still show up in search results, they just won't have typed parameters. The adapter infers read-only status from the function name when there's no tag. Names containing "get", "list", or "fetch" default to read-only.

### Filtering

Filter which functions get discovered:

```javascript
{
  name: 'payments',
  adapter: 'lambda',
  source: 'us-east-1',
  options: {
    prefix: 'myapp-payments-',       // only functions starting with this
    tags: { team: 'payments' },      // only functions with these tags
  },
}
```

## Requirements

AWS discovery mode needs the AWS SDK:

```bash
npm install @aws-sdk/client-lambda
```

Your environment needs valid AWS credentials (via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, IAM role, or AWS profile). The adapter needs `lambda:ListFunctions`, `lambda:ListTags`, and `lambda:InvokeFunction` permissions.

Manifest file mode has no extra dependencies.

## Function naming

The adapter strips common prefixes to generate clean method names:

| Lambda function name | SDK method name |
|---------------------|-----------------|
| `myapp-payments-processPayment` | `processPayment` |
| `prod-users-getUserById` | `getUserById` |
| `myapp_list_orders` | `listOrders` |
| `GetOrderStatus` | `getOrderStatus` |

Environment prefixes (`dev-`, `staging-`, `prod-`, `test-`) are stripped automatically.

## How invocation works

When Claude writes `await sdk.payments.processPayment({ amount: 5000 })`, codemode-x:

1. Serializes the params as JSON
2. Calls `Lambda.invoke()` with `InvocationType: 'RequestResponse'`
3. Parses the response payload
4. If the Lambda returns an API Gateway-style response (`{ statusCode, body }`), unwraps the body automatically

Credentials for the Lambda call come from your environment. They never touch the LLM context.

## Working with lots of functions

The manifest approach works fine at 1000+ functions. You can generate the base file from AWS and fill in the schemas:

```bash
aws lambda list-functions --region us-east-1 \
  --query 'Functions[].{functionName:FunctionName,description:Description}' \
  --output json > functions.json

# Then add input/output schemas manually or with a script
```

Group functions into domains by service or team:

```javascript
export default {
  sdkName: 'platform',
  domains: [
    { name: 'payments', adapter: 'lambda', source: './manifests/payments.json' },
    { name: 'users', adapter: 'lambda', source: './manifests/users.json' },
    { name: 'inventory', adapter: 'lambda', source: './manifests/inventory.json' },
    { name: 'notifications', adapter: 'lambda', source: './manifests/notifications.json' },
  ],
};
```

Claude still sees 2 MCP tools. When it searches for "process payment", it gets back only the matching functions with their types, not all 1000.
