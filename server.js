import express from "express";
import body_parser from "body-parser";
import OpenAI from "openai";
import mysql from 'mysql2/promise';
import env from "dotenv";
                                                                                     
env.config();


const app = express();

const port = 3000;

app.use(express.static('public'));
app.use(body_parser.urlencoded({extended: true}));

//openai api
const token = process.env.API_KEY;
const endpoint = "https://models.inference.ai.azure.com";
const modelName = "gpt-4o";

const client = new OpenAI({ baseURL: endpoint, apiKey: token });

async function get_doctors_by_specialty(specialty){
  const [result] = await connection.query("Select first_name from doctors inner join specialties on doctors.specialty_id = specialties.specialty_id where specialty_name = ?", [specialty]);
  let doctors = [];
  for(const doctor of result){
    doctors.push(doctor['first_name']);
  }
  return doctors? "Here are some doctors for the specialty: "+specialty+ "; doctors: "+ doctors.join(", ")+"." : "No doctors available for the specialty : "+specialty +".";

}


//mysql

const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'pulse',
  password: "123456"
});
var specialties = [];
try{
  const [result] = await connection.query("Select specialty_name from specialties");
  result.forEach(function (e){
    specialties.push(e["specialty_name"]);
  });

}catch(error){
  console.log(error);
}

//routes

app.get("/", async function(req,res){
  
  res.render("index.ejs");
});

app.get("/chat", async function(req,res){
  
  res.render("chat.ejs");
});

app.post("/chat",async function(req,res){
    var input = [
      { role:"system", content: "You are a helpful medical assistant for an app of many clinics and doctors ready to offer their services. Your role is to recommend doctors to the user based on their symptoms (directly start recommending doctors after symptoms is sent). To get doctors' info use the 'get_doctors_by_specialty' tool with a specialty parameter from the following available specialties: "+ specialties.join(", ") +"."},
      { role:"user", content: req.body.message }
    ]

    const tools = [{
      "type": "function",
      "function" : {
        "name": "get_doctors_by_specialty",
        "description": "Get available doctors for a given specialty based on user symptoms.",
        "parameters": {
          "type": "object",
          "properties":{
            "specialty":{
              "type": "string",
              "description": "Doctor's specialty e.g. Cardiologist, Chiropractor"
            }
          },
          "required": ["specialty"]
        },
        
      }
    }];

    const completion = await client.chat.completions.create({
          messages: input,
          temperature: 1.0,
          top_p: 1.0,
          max_tokens: 1000,
          model: modelName,
          tools : tools,
          tool_choice: "auto"
    });
    const response = completion.choices[0].message;
    console.log(response);
    input.push(response);
    if(response.tool_calls) {
      for(const tool of response.tool_calls){
        const args = JSON.parse(tool.function.arguments);
        const result = await get_doctors_by_specialty(args.specialty);
        
        input.push({
          role: "tool",
          tool_call_id: tool.id,
          name: tool.function.name,
          content: result
        })
      }
      console.log(input);

      const follow_up = await client.chat.completions.create({
        messages: input,
        temperature: 1.0,
        top_p: 1.0,
        max_tokens: 1000,
        model: modelName,
        tools : tools,
        tool_choice: "auto"
      });

      return res.send(follow_up.choices[0].message.content);
    }

    res.send(completion.choices[0].message.content);


    
    // for await (const chunk of completion) {
    //   const content = chunk.choices[0]?.delta?.content || '';
    //   res.write(content);
    // }
    // res.end();
});


app.post("/chat2", async function(req,res){
  var input = [
    { role:"system", content: "You are a helpful medical assistant for an app of many clinics and doctors ready to offer their services. Your role is to recommend doctors to the user based on their symptoms (directly start recommending doctors after symptoms is sent). To get doctors' info use the 'get_doctors_by_specialty' tool with a specialty parameter from the following available specialties: "+ specialties.join(", ") +"."},
    { role:"user", content: req.body.message }
  ]

  const tools = [{
    "type": "function",
    "function" : {
      "name": "get_doctors_by_specialty",
      "description": "Get available doctors for a given specialty based on user symptoms.",
      "parameters": {
        "type": "object",
        "properties":{
          "specialty":{
            "type": "string",
            "description": "Doctor's specialty e.g. Cardiologist, Chiropractor"
          }
        },
        "required": ["specialty"]
      },
      
    }
  }];

  const completion = await client.chat.completions.create({
        messages: input,
        temperature: 1.0,
        top_p: 1.0,
        max_tokens: 1000,
        model: modelName,
        tools : tools,
        tool_choice: "auto",
        stream : true
  });

  const finalToolCalls = [];
  let toolCallDetected = false;

  for await (const chunk of completion) {
    
    const delta = chunk.choices[0]?.delta;

    if (delta?.tool_calls) {
      toolCallDetected = true;
      const toolCalls = delta.tool_calls;
      for (const toolCall of toolCalls) {
          const { index } = toolCall;

          if (!finalToolCalls[index]) {
              finalToolCalls[index] = toolCall;
          }

          finalToolCalls[index].function.arguments += toolCall.function.arguments;
      }
      continue;
    }

    if (toolCallDetected) continue;

    const content = delta?.content;
    if (content) {
      console.log(content);
      res.write(content);
    }
  }

  if(toolCallDetected){
    console.log(finalToolCalls);
    input.push({
      role: "assistant",
      tool_calls: finalToolCalls
    });
    if(finalToolCalls) {
      for(const tool of finalToolCalls){
        const args = JSON.parse(tool.function.arguments);
        const result = await get_doctors_by_specialty(args.specialty);

        input.push({
          role: "tool",
          tool_call_id: tool.id,
          name: tool.function.name,
          content: result
        })
      }

      const follow_up = await client.chat.completions.create({
        messages: input,
        temperature: 1.0,
        top_p: 1.0,
        max_tokens: 1000,
        model: modelName,
        tools : tools,
        tool_choice: "auto",
        stream: true
      });

      for await (const chunk of follow_up) {
        const content = chunk.choices[0]?.delta?.content || '';
        res.write(content);
      }
      return res.end();
    }
  }
  res.end();
  
});




app.listen(port, function(){
    console.log("Listening on port: "+ port);
});