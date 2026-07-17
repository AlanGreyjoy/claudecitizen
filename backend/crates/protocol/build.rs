fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    let proto = "../../../proto/world.proto";

    let mut config = prost_build::Config::new();
    config.protoc_executable(protoc);
    config.boxed(".cc.world.v1.ClientEnvelope.payload.presence_intent");
    config.boxed(".cc.world.v1.ServerEnvelope.payload.reconcile");
    config.compile_protos(&[proto], &["../../../proto"])?;
    println!("cargo:rerun-if-changed={proto}");
    Ok(())
}
