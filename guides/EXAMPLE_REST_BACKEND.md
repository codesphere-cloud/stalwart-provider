# Example REST Backend

A minimal Node.js implementation of the [Codesphere Managed Service Adapter API](https://docs.codesphere.com/managed-services/create-custom-rest-backend).

This backend provides the four required endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Create a new service |
| `GET` | `/?id=...` | Get status of services (or list all IDs) |
| `PATCH` | `/:id` | Update an existing service |
| `DELETE` | `/:id` | Delete a service |

## Quick Start

```bash
npm i
. .example.env && npm start
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3000` | Port to listen on |

## Customization

This example uses an in-memory store. Replace the `TODO` comments in `server.js` with your actual infrastructure provisioning logic (e.g., cloud API calls, Kubernetes operations, database management).
