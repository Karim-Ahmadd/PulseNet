function show(){
    console.log("yes");
    const show_btn = document.querySelector(".btn-show");
    const side_bar = document.querySelector(".sidebar");
    
    side_bar.classList.add("show");
  }
  
function close_bar(){
    console.log("yes");
    const show_btn = document.querySelector(".btn-show");
    const side_bar = document.querySelector(".sidebar");
    
    side_bar.classList.remove("show");
  }