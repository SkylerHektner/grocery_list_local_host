const addNameBtn = document.getElementById("add-name-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const cancelBtn = document.getElementById("cancel-btn");
const submitBtn = document.getElementById("submit-btn");
const nameInput = document.getElementById("name-input");

// Open modal
addNameBtn.addEventListener("click", () => {
  modalBackdrop.classList.remove("hidden");
  nameInput.value = "";
  nameInput.focus();
});

// Close modal
cancelBtn.addEventListener("click", () => {
  modalBackdrop.classList.add("hidden");
});

// Handle submit
submitBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const response = await fetch("/api/names", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name }),
    });

    if (response.ok) {
      alert("Name successfully added!");
      modalBackdrop.classList.add("hidden");
    } else {
      alert("Failed to add name.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});
