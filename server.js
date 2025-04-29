import express from "express";
import body_parser from "body-parser";
import OpenAI from "openai";
import mysql from 'mysql2/promise';
import schema from './lib/DB_schema.js';
import env from "dotenv";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import bcrypt from "bcrypt";
import valid from "validator";


env.config();


const app = express();

const port = 3000;

const saltRounds = 12;

// console.log(bcrypt.hashSync("admin1234", saltRounds));

app.use(express.static('public'));
app.use(body_parser.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24
    }

  })
);

app.use(passport.initialize());
app.use(passport.session());


//openai api
const token = process.env.API_KEY;
const endpoint = "https://models.inference.ai.azure.com";
const modelName = "gpt-4o";

const client = new OpenAI({ baseURL: endpoint, apiKey: token });

async function get_doctors_by_specialty(specialty) {
  const [result] = await connection.query("Select first_name from doctors inner join specialties on doctors.specialty_id = specialties.specialty_id where specialty_name = ?", [specialty]);
  let doctors = [];
  for (const doctor of result) {
    doctors.push(doctor['first_name']);
  }
  return doctors ? "Here are some doctors for the specialty: " + specialty + "; doctors: " + doctors.join(", ") + "." : "No doctors available for the specialty : " + specialty + ".";

}

async function execute_sql(query) {
  try {
    console.log(query);
    if (!query.trim().toLowerCase().startsWith('select')) {
      return "Only SELECT queries are allowed.";
    }

    const [rows] = await connection.query(query);

    if (rows.length === 0) {
      return "No results found.";
    }

    console.log(JSON.stringify(rows, null, 2));

    return "Query executed successfully.\nResult:\n" + JSON.stringify(rows, null, 2);

  } catch (error) {
    console.error("SQL Execution Error:", error);
    return "failed to load query";
  }
}

function getDate_Time(){
  return (new Date).toLocaleString();
}

async function call_tools(func_name, params) {
  if (func_name == "get_doctors_by_specialty") {
    return await get_doctors_by_specialty(params.specialty);
  } else if (func_name == "get_from_db") {
    return await execute_sql(params.query);
  } else{
    return getDate_Time();
  }
}


//mysql

const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'pulse',
  password: "123456"
});
var specialties = [];
try {
  const [result] = await connection.query("Select specialty_name from specialties");
  result.forEach(function (e) {
    specialties.push(e["specialty_name"]);
  });

} catch (error) {
  console.log(error);
}

//routes

app.get("/", async function (req, res) {

  res.render("index.ejs");
});

app.get("/login", function (req, res) {
  res.render("login.ejs");
})

app.post("/login",
  passport.authenticate(
    "local",
    {
      successRedirect: "/user",
      failureRedirect: "/login",
      failureMessage: true
    })
);

app.get("/user", function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {
    res.redirect("/doctor");
  } else if (req.isAuthenticated() && req.user.role_id == 3) {
    res.render("patient/patient.ejs");
  } else if (req.isAuthenticated() && req.user.role_id == 1) {
    res.redirect("/admin");
  } else {
    res.redirect("/login");
  }

});

//Admin
app.get("/admin", function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {
    res.render("admin/admin.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/admin/clinics/add", function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {
    res.render("admin/addClinic.ejs");
  } else {
    res.redirect("/login");
  }
});

app.post("/admin/clinics/add", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {
    var error = false;

    const clinic_name = req.body.clinic_name;
    const clinic_address = req.body.clinic_address;
    const clinic_phone = req.body.clinic_phone;
    const clinic_email = req.body.clinic_email;
    const clinic_description = req.body.clinic_description;

    if (!clinic_name && clinic_name == "" && clinic_name.length > 100) {
      error = true;
    }
    if (!clinic_address && clinic_address == "" && clinic_address.length > 255) {
      error = true;
    }
    if (!clinic_phone && !isNaN(clinic_phone) && clinic_phone == "" && clinic_phone.length != 8) {
      error = true;
    }
    if (!clinic_email && clinic_email == "" && clinic_email.length > 100 && !valid.isEmail(clinic_email)) {
      error = true;
    }
    if (!clinic_description && clinic_description == "") {
      error = true;
    }
    if (!error) {
      try {
        await connection.query("INSERT INTO `pulse`.`clinics` (`name`,`address`,`phone`,`email`,`description`) VALUES (?,?,?,?,?)", [clinic_name, clinic_address, clinic_phone, clinic_email, clinic_description]);
        res.redirect("/admin");

      } catch (e) {
        console.log(e);
      }
    } else {
      res.redirect("/admin/clinics/add");
    }


  } else {
    res.redirect("/login");
  }
});

//Doctor
app.get("/doctor", function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {
    res.render("doctor/doctor.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/doctor/schedule", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {
    const [result] = await connection.query("Select clinics.clinic_id, clinics.name from clinic_doctor inner join clinics on clinics.clinic_id = clinic_doctor.clinic_id where doctor_id = ?", [req.user.user_id]);
    res.render("doctor/schedule.ejs", { clinics: result });
  } else {
    res.redirect("/login");
  }
});

app.post("/doctor/schedule", function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {

    res.render("doctor/schedule.ejs");
  } else {
    res.redirect("/login");
  }
});

//ChatBot

app.get("/chat", async function (req, res) {

  res.render("chat.ejs");
});

app.post("/chat", async function (req, res) {
  var input = [
    { role: "system", content: "You are a helpful medical assistant for an app of many clinics and doctors ready to offer their services. Your role is to recommend doctors to the user based on their symptoms (directly start recommending doctors after symptoms is sent). To get doctors' info use the 'get_doctors_by_specialty' tool with a specialty parameter from the following available specialties: " + specialties.join(", ") + "." },
    { role: "user", content: req.body.message }
  ]

  const tools = [{
    "type": "function",
    "function": {
      "name": "get_doctors_by_specialty",
      "description": "Get available doctors for a given specialty based on user symptoms.",
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


app.post("/chat2", async function (req, res) {
  var input = [
    { role: "system", content: "You are a helpful medical assistant for an app of many clinics and doctors ready to offer their services. Your role is to respond to the user's questions based on the available data. To get the needed data use the 'get_doctors_by_specialty' tool with a specialty parameter or the 'get_from_db' tool with an sql query. The current time is " +(new Date).toLocaleString()+ "." },
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
            "description": "SQL query to get data from a SQL database. Put single quotes around the field but not table names. Select query only! And for more accurate searches use SQL 'LIKE' or any other efficient searching method. Often called with 'getDate_Time' tool to get current time."
          }
        },
        "required": ["query"]
      },

    }
  },
  // {
  //   "type": "function",
  //   "function": {
  //     "name": "getDate_Time",
  //     "description": "Get current Date and Time"

  //   }
  // }

];

  const completion = await client.chat.completions.create({
    messages: input,
    temperature: 1.0,
    top_p: 1.0,
    max_tokens: 1000,
    model: modelName,
    tools: tools,
    tool_choice: "auto",
    stream: true
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

  if (toolCallDetected) {
    console.log(finalToolCalls);
    input.push({
      role: "assistant",
      tool_calls: finalToolCalls
    });
    if (finalToolCalls) {
      for (const tool of finalToolCalls) {
        const args = JSON.parse(tool.function.arguments);
        const result = await call_tools(tool.function.name, args);

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
        tools: tools,
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

passport.use("local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const [result] = await connection.query("SELECT * FROM users WHERE email = ? ", [
        username,
      ]);
      console.log(result);
      if (result.length > 0) {
        const user = result[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err); //returns error
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);  //on success the "user" object is added to the session via the serializeUser and deserializeUser functions
              //return cb(null, {id: user.id}) //you can only save the is to the session
            } else {
              //Did not pass password check
              return cb(null, false, { message: "Incorrect email or password." });
            }
          }
        });
      } else {
        return cb(null, false, { message: "Incorrect email or password." });
      }
    } catch (err) {
      return cb(err); //returns error
    }
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user);  //"user" object attaches to the request as req.session.passport.user
});
passport.deserializeUser((user, cb) => {
  cb(null, user);  //"user" object attaches to the request as req.user
});



app.listen(port, function () {
  console.log("Listening on port: " + port);
});