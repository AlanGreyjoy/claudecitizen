use bytes::{Buf, BufMut, BytesMut};
use prost::Message;
use thiserror::Error;

pub const PROTOCOL_VERSION: u32 = 1;
pub const SIMULATION_VERSION: u32 = 1;
pub const MAX_DATAGRAM_BYTES: usize = 48 * 1024;
pub const MAX_STREAM_FRAME_BYTES: usize = 256 * 1024;

pub mod world {
    include!(concat!(env!("OUT_DIR"), "/cc.world.v1.rs"));
}

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("frame exceeds the configured maximum")]
    TooLarge,
    #[error("stream ended before a complete frame arrived")]
    Incomplete,
    #[error("protobuf decode failed: {0}")]
    Decode(#[from] prost::DecodeError),
}

pub fn encode_message<M: Message>(message: &M) -> Vec<u8> {
    message.encode_to_vec()
}

pub fn decode_datagram<M: Message + Default>(payload: &[u8]) -> Result<M, FrameError> {
    if payload.len() > MAX_DATAGRAM_BYTES {
        return Err(FrameError::TooLarge);
    }
    Ok(M::decode(payload)?)
}

pub fn encode_stream_frame<M: Message>(message: &M) -> Result<Vec<u8>, FrameError> {
    let payload = message.encode_to_vec();
    if payload.len() > MAX_STREAM_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    let mut frame = BytesMut::with_capacity(4 + payload.len());
    frame.put_u32(payload.len() as u32);
    frame.extend_from_slice(&payload);
    Ok(frame.to_vec())
}

pub fn decode_stream_frame<M: Message + Default>(frame: &[u8]) -> Result<M, FrameError> {
    if frame.len() < 4 {
        return Err(FrameError::Incomplete);
    }
    let mut cursor = frame;
    let payload_len = cursor.get_u32() as usize;
    if payload_len > MAX_STREAM_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    if cursor.remaining() < payload_len {
        return Err(FrameError::Incomplete);
    }
    Ok(M::decode(&cursor[..payload_len])?)
}

pub fn verify_protocol(version: u32) -> Result<(), ProtocolVersionError> {
    if version == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(ProtocolVersionError {
            expected: PROTOCOL_VERSION,
            received: version,
        })
    }
}

#[derive(Debug, Error)]
#[error("protocol version mismatch: expected {expected}, received {received}")]
pub struct ProtocolVersionError {
    pub expected: u32,
    pub received: u32,
}
