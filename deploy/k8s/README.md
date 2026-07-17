# Kubernetes backend deployment

These manifests deploy the single Rust backend as horizontally scalable HTTP and WebTransport replicas. PostgreSQL and Redis are external platform dependencies; their URLs and all credentials belong in the `claudecitizen-backend-secrets` Secret.

Apply in this order:

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.example.yaml # replace every example value first
kubectl apply -f service-account.yaml
kubectl apply -f migration-job.yaml
kubectl wait --for=condition=complete job/claudecitizen-migrate -n claudecitizen --timeout=5m
kubectl apply -f service.yaml -f deployment.yaml -f hpa.yaml -f pdb.yaml -f network-policy.yaml
kubectl apply -f ingress.example.yaml # set the real API hostname/TLS secret first
```

The platform load balancer must support UDP on port 443 for WebTransport/HTTP3. Point `WEBTRANSPORT_PUBLIC_URL` at that UDP load balancer. The WebTransport TLS Secret must contain `tls.crt` and `tls.key`; public certificates do not use the development certificate-hash override.

The migration Job must complete before the Deployment is updated. Application pods set `RUN_MIGRATIONS=false`, so replicas never race schema changes during scale-out.

