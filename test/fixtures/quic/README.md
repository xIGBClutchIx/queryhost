# QUIC fixtures

`server-cert.pem` and `server-key.pem` are a throwaway self-signed P-256 certificate and key
(`CN=rcgen self signed cert`, SAN `DNS:reclaimer`). They were generated for these tests to
mirror what Project Reclaimer servers present. The fake QUIC server in
`test/helpers/fake-quic-server.ts` signs its CertificateVerify with this key. The key protects
nothing. The client never checks the certificate's validity dates, so expiry does not affect the
tests.
