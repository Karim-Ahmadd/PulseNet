import connection from "./DB_connection"

var specialties = [];
try {
  const [result] = await connection.query("Select specialty_name from specialties");
  result.forEach(function (e) {
    specialties.push(e["specialty_name"]);
  });

} catch (error) {
  console.log(error);
}

app.post("/chat", async function (req, res) {
  var input = [
    { role: "system", content: "You are a helpful medical assistant for an app of many clinics and doctors ready to offer their services. Your role is to recommend doctors to the user based on their symptoms (directly start recommending doctors after symptoms is sent). To get doctors' info use the 'get_doctors_by_specialty' tool with a specialty parameter from the following available specialties: " + specialties.join(", ") + "." },
    { role: "user", content: req.body.message }
  ]

  const tools = [{
    "type": "function",
    "function": {
      "name": "get_doctors_by_specialty",
      "description": "Get available doctors for a given specialty based on user symptoms. The possible specialties are: " + specialties.join(", ") + ".",
      "parameters": {
        "type": "object",
        "properties": {
          "specialty": {
            "type": "string",
            "description": "Doctor's specialty e.g. Cardiologist, Chiropractor"
          }
        },
        "required": ["specialty"]
      },

    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_from_db",
      "description": `Get data from a database, the database has the following schema:
  
          ${schema}
          
          `,
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "SQL query to get data from a SQL database. Put quotes around the field and table names"
          }
        },
        "required": ["query"]
      },

    }
  },
  {
    "type": "function",
    "function": {
      "name": "getDate_Time",
      "description": "Get current Date and Time"

    }
  }
  ];

  const completion = await client.chat.completions.create({
    messages: input,
    temperature: 1.0,
    top_p: 1.0,
    max_tokens: 1000,
    model: modelName,
    tools: tools,
    tool_choice: "auto"
  });
  const response = completion.choices[0].message;
  console.log(response);
  input.push(response);
  if (response.tool_calls) {
    for (const tool of response.tool_calls) {
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
      tools: tools,
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