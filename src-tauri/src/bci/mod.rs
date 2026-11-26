//! BrainBit BLE hardware transport (NeuroSDK2 C ABI), live contact monitoring, and CSV dump recorder.

pub mod contact;
pub mod driver;
pub mod neurosdk_ffi;
pub mod recorder;

pub use driver::BrainBitDriver;
pub use recorder::EegDumpRecorder;
