# Vintage Story fixtures

- `query-complete.hex` is the stock 1.22.7 liveness acknowledgement captured from a current public server after sending the official empty server-query packet.
- `query-answer.hex` is a deterministic packet generated from the official 1.22.7 `Packet_ServerQueryAnswer` field schema. It exercises every documented status field without depending on the central server list.

Both packets use Vintage Story's four-byte big-endian TCP length prefix and protobuf-like packet serializers. The stock capture intentionally contains no server-list metadata: current stock servers only confirm that the query completed.
