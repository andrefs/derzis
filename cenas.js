
const endpoint = "https://api.iaedu.pt/agent-chat//api/v1/agent/cmamvd3n40000c801qeacoad2/stream";
const formData = new FormData();
// Required Fields
formData.append("channel_id", "cmlgw1drb1gmuhd01zv4liip7");
formData.append("thread_id", "QbAxhvQqoZuhwki4NZT2X");
formData.append("user_info", "{}"); // Mandatory field, where you can enter user information
formData.append("message", "What is the value of X?");
// Optionally you can add these fields:
// user_id: string
// user_context: string object with any key-value pairs
// image: File
// Check documentation for more examples.
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "multipart/form-data",
    'x-api-key': "sk-usr-sjkohjr7hjqkg1wqpka3fcqclppryendmo",
  },
  body: formData,
});

console.log(response);
