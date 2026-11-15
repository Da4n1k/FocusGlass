//! BrainBit BLE hardware transport (NeuroSDK2 C ABI) and live contact monitoring.

pub mod contact;
pub mod driver;
pub mod neurosdk_ffi;

pub use driver::BrainBitDriver;
