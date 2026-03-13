const origExit = process.exit;

process.exit = function(code = 0) {
  console.error("\n=== process.exit called ===");
  console.error("code:", code);
  console.error(new Error("exit stack").stack);
  return origExit.call(this, code);
};

process.on("exit", (code) => {
  console.error("\n=== process exit event ===");
  console.error("code:", code);
});
