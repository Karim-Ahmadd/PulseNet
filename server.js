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
import multer from "multer";
import { fileTypeFromBuffer } from 'file-type';
import connection from "./lib/DB_connection";
import { save_chat_memory, load_chat_memory } from "./lib/chatbot_memory";
import fs from "fs";
import { v4 as uuidv4 } from 'uuid';
import path from "path";
import { validate_clinic_schedule_form, getNextDate, validate_doctor_schedule_form, tConvert } from "./lib/schedule_form";
import { call_tools } from "./lib/chat_tools";
import { toZonedTime } from 'date-fns-tz'


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

//multer
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});


//openai api
const token = process.env.API_KEY;
const endpoint = "https://models.inference.ai.azure.com";
const modelName = "gpt-4o";

const client = new OpenAI({ baseURL: endpoint, apiKey: token });



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

app.post("/admin/clinics/add", upload.single("file"), async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {
    var errors = {};
    var isError = false;

    const clinic_name = req.body.clinic_name;
    const clinic_address = req.body.clinic_address;
    const clinic_phone = req.body.clinic_phone;
    const clinic_email = req.body.clinic_email;
    const clinic_description = req.body.clinic_description;


    if (!clinic_name && clinic_name == "") {
      errors["name"] = "Clinic name is empty!";
      isError = true;
    } else if (clinic_name.length > 100) {
      errors["name"] = "Clinic name is larger than 100!";
      isError = true;
    }

    if (!clinic_address && clinic_address == "") {
      errors["address"] = "Clinic address is empty!";
      isError = true;
    } else if (clinic_address.length > 255) {
      errors["address"] = "Clinic address is larger than 255!";
      isError = true;
    }

    if (!clinic_phone && clinic_phone == "") {
      errors["phone"] = "Clinic phone is empty!";
      isError = true;
    } else if (isNaN(clinic_phone)) {
      errors["phone"] = "Clinic phone is not a number!";
      isError = true;
    } else if (clinic_phone.length != 8) {
      errors["phone"] = "Clinic phone size should be 8!";
      isError = true;
    }

    if (!clinic_email && clinic_email == "") {
      errors["email"] = "Clinic email is empty";
      isError = true;
    } else if (clinic_email.length > 100) {
      errors["email"] = "Clinic email is larger than 100!";
      isError = true;
    } else if (!valid.isEmail(clinic_email)) {
      errors["email"] = "Clinic email is invalid";
      isError = true;
    }

    if (!clinic_description && clinic_description == "") {
      errors["description"] = "Clinic description is empty";
      isError = true;
    }

    if (!req.file) {
      errors["file"] = "Please upload a logo image";
      isError = true;
    } else {
      try {
        const fileType = await fileTypeFromBuffer(req.file.buffer);
        console.log(fileType);
        if (!fileType.mime.startsWith("image/")) {
          errors["file"] = "Invalid file type";
          isError = true;
        }
      } catch (e) {
        errors["file"] = "Invalid file type";
        isError = true;
      }
    }

    console.log(errors);
    if (!isError) {
      try {
        const filename = uuidv4();
        const filepath = path.join("public", "images", filename);
        fs.writeFileSync(filepath, req.file.buffer);

        await connection.query("INSERT INTO `pulse`.`clinics` (`name`,`address`,`phone`,`email`,`description`, `logo`) VALUES (?,?,?,?,?,?)", [clinic_name, clinic_address, clinic_phone, clinic_email, clinic_description, `/images/${filename}`]);
        res.redirect("/admin");

      } catch (e) {
        console.log(e);
      }
    } else {
      res.render("admin/addClinic.ejs", { errors: errors });
    }


  } else {
    res.redirect("/login");
  }
});

app.get("/admin/clinics/schedule", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {
    const [result] = await connection.query("Select * from clinics");
    console.log(result);
    res.render("admin/clinic_schedule_form.ejs", { clinics: result });
  } else {
    res.redirect("/login");
  }

});

app.get("/admin/clinics/addSchedule/:id", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {

    const [result] = await connection.query("Select * from clinics where clinic_id = ?", [req.params.id]);
    if (result.length === 0) {
      res.redirect("/admin/clinics/schedule");
    } else {
      res.render("admin/clinic_schedule_form.ejs", { clinic_id: req.params.id });
    }

  } else {
    res.redirect("/login");
  }

});

app.post("/admin/clinics/addSchedule", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 1) {

    const clinicId = req.body.clinic_id;
    const availableDays = req.body.day;
    const startTime = req.body.open_time;
    const endTime = req.body.close_time;
    const weeksToGenerate = req.body.weeks_to_generate;

    const dayNumberToName = {
      0: 'Sunday',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday'
    };


    const [result] = await connection.query("Select * from clinics where clinic_id = ?", [clinicId]);
    if (result.length > 0) {
      const errors = validate_clinic_schedule_form(availableDays, startTime, endTime, weeksToGenerate);
      if (!errors.iserror) {
        const today = toZonedTime(new Date(), "Asia/Beirut");
        availableDays.forEach(async day => {
          let currentDate = getNextDate(day, today);

          for (let week = 0; week < weeksToGenerate; week++) {
            const dateStr = currentDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Beirut" }); // format as 'YYYY-MM-DD' Beirut time

            // === Add/Update clinic_calendar row ===
            try {
              await connection.query("INSERT INTO `pulse`.`clinic_calendar` (`clinic_id`,`day_of_week`,`is_open`,`opening_time`,`closing_time`,`date`)VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE opening_time = VALUES(opening_time), closing_time = VALUES(closing_time),is_open = 1", [clinicId, dayNumberToName[day], 1, startTime, endTime, dateStr]);
            } catch (e) {
              console.log(e);
            }

            currentDate.setDate(currentDate.getDate() + 7);
          }
        });
        res.redirect("/admin/clinics/calendar/" + clinicId);
      } else {
        res.redirect("/admin/clinics/addSchedule/" + clinicId);
      }

    } else {
      res.redirect("/admin/clinics/addSchedule" + clinicId);
    }


  } else {
    res.redirect("/login");
  }
});

app.get("/admin/clinics/calendar/:id", async function (req, res) {

  if (req.isAuthenticated() && req.user.role_id == 1) {

    const [result] = await connection.query("Select * from clinics where clinic_id = ?", [req.params.id]);
    if (result.length === 0) {
      res.redirect("/admin/clinics/schedule");
    } else {
      res.render("admin/clinic_calendar.ejs", { clinic_id: req.params.id });
    }

  } else {
    res.redirect("/login");
  }

});

app.get("/clinics/schedule", async function (req, res) {
  const { start, end, clinic_id } = req.query;
  console.log(start);
  console.log(end);
  console.log(clinic_id);
  if (!start || !end || !clinic_id) {
    return res.status(400).json({ error: 'clinic ID, start and end date required' });
  }

  try {
    const [rows] = await connection.query(
      `SELECT substr(date, 1, 10) as date, day_of_week, opening_time, closing_time, clinic_id 
       FROM clinic_calendar 
       WHERE is_open = 1 AND date BETWEEN ? AND ? and clinic_id = ?`,
      [start, end, clinic_id]
    );
    console.log(rows);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get("/admin/clinics/updateSchedule", async function (req, res) {

  if (req.isAuthenticated() && req.user.role_id == 1) {

    const { clinic_id, date } = req.query;
    const [result] = await connection.query("Select schedule_id, opening_time, closing_time from clinic_calendar where clinic_id = ? and date =?", [clinic_id, date]);
    if (result.length === 0) {
      res.redirect("/admin/clinics/schedule");
    } else if (result.length === 1) {
      res.render("admin/clinic_schedule_form.ejs", { start: result[0]["opening_time"].substring(0, 5), end: result[0]["closing_time"].substring(0, 5), schedule_id: result[0]["schedule_id"], clinic_id: clinic_id });
    }

  } else {
    res.redirect("/login");
  }



});

app.post("/admin/clinics/updateSchedule", async function (req, res) {

  if (req.isAuthenticated() && req.user.role_id == 1) {

    const { clinic_id, schedule_id, open_time, close_time } = req.body;
    const [result] = await connection.query("Select 1 from clinic_calendar where schedule_id = ?", [schedule_id]);
    if (result.length === 0) {
      res.redirect("/admin/clinics/schedule");
    } else if (result.length === 1) {
      await connection.query("update clinic_calendar set opening_time = ?, closing_time = ? where schedule_id = ?", [open_time, close_time, schedule_id]);
      res.redirect(`/admin/clinics/calendar/${clinic_id}`);
    }

  } else {
    res.redirect("/login");
  }



});

app.post("/admin/clinics/deleteSchedule", async function (req, res) {

  if (req.isAuthenticated() && req.user.role_id == 1) {

    const { clinic_id, schedule_id } = req.body;
    const [result] = await connection.query("Select 1 from clinic_calendar where schedule_id = ?", [schedule_id]);
    if (result.length === 0) {
      res.redirect("/admin/clinics/schedule");
    } else if (result.length === 1) {
      await connection.query("update clinic_calendar set is_open = 0 where schedule_id = ?", [schedule_id]);
      res.redirect(`/admin/clinics/calendar/${clinic_id}`);
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

app.get("/doctor/test", function (req, res) {
  res.render("doctor/test.ejs");
});

app.get("/doctor/addSchedule", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {
    const [result] = await connection.query("Select clinics.clinic_id, clinics.name from clinic_doctor inner join clinics on clinics.clinic_id = clinic_doctor.clinic_id where doctor_id = ?", [req.user.user_id]);
    res.render("doctor/schedule.ejs", { clinics: result });
  } else {
    res.redirect("/login");
  }
});

app.post("/doctor/addSchedule", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {

    const clinicId = req.body.clinic;
    const availableDays = req.body.day;
    const startTime = req.body.open_time;
    const endTime = req.body.close_time;
    const weeksToGenerate = req.body.weeks_to_generate;
    const lunchStart = req.body.lunch_start;
    const lunchEnd = req.body.lunch_end;
    const appointmentDurationMinutes = req.body.appointments_duration;

    const dayNumberToName = {
      0: 'Sunday',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday'
    };
    var lastInsertId;
    const errors = await validate_doctor_schedule_form(availableDays, startTime, endTime, lunchStart, lunchEnd, appointmentDurationMinutes, weeksToGenerate, clinicId, req.user.user_id);
    console.log(errors);
    if (!errors.iserror) {

      const today = toZonedTime(new Date(), "Asia/Beirut");
      availableDays.forEach(async day => {
        let currentDate = getNextDate(day, today);

        for (let week = 0; week < weeksToGenerate; week++) {
          const dateStr = currentDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Beirut" }); // format as 'YYYY-MM-DD' Beirut time

          // === Add/Update clinic_calendar row ===
          try {
            const [result, fields] = await connection.execute("INSERT INTO `pulse`.`doctor_calendar` (`doctor_id`,`clinic_id`,`day_of_week`,`start_time`,`end_time`,`is_available`,`date`)VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time),is_available = 1, clinic_id = VALUES(clinic_id)", [req.user.user_id, clinicId, dayNumberToName[day], startTime, endTime, 1, dateStr]);

            lastInsertId = result.insertId;
            if(!lastInsertId){
              const [result] = await connection.query("Select schedule_id from doctor_calendar where doctor_id =? and date = ?", [req.user.user_id, dateStr]);
              lastInsertId = result[0]["schedule_id"];
            }
          } catch (e) {
            console.log(e);
          }

          const startParts = startTime.split(':').map(Number);
          const endParts = endTime.split(':').map(Number);
          let slotStart = new Date(currentDate);
          slotStart.setHours(startParts[0], startParts[1], 0, 0);

          const slotEnd = new Date(currentDate);
          slotEnd.setHours(endParts[0], endParts[1], 0, 0);

          await connection.execute("Delete from appointment_slots where doctor_day_id = ?", [lastInsertId]);
          while (slotStart < slotEnd) {
            const nextSlot = new Date(slotStart.getTime() + appointmentDurationMinutes * 60000);

            const slotStartTime = slotStart.toTimeString().substring(0, 5);
            const slotEndTime = nextSlot.toTimeString().substring(0, 5);

            if (nextSlot > slotEnd) break;

            if (
              (slotStartTime >= lunchStart && slotStartTime < lunchEnd) ||
              (slotEndTime > lunchStart && slotEndTime <= lunchEnd)
            ) {
              slotStart = nextSlot;
              continue;
            }

            try{
            await connection.query("INSERT INTO `pulse`.`appointment_slots` (`doctor_id`,`clinic_id`,`slot_date`,`start_time`,`end_time`,`doctor_day_id`)VALUES(?,?,?,?,?,?)", [req.user.user_id, clinicId,dateStr, slotStartTime, slotEndTime, lastInsertId]);
            }catch(e){
              console.log(e);
            }

            slotStart = nextSlot;
          }

          // Move to next week's same day
          currentDate.setDate(currentDate.getDate() + 7);
        }
        res.redirect("/doctor/addSchedule");
      });


    } else {
      const [result] = await connection.query("Select clinics.clinic_id, clinics.name from clinic_doctor inner join clinics on clinics.clinic_id = clinic_doctor.clinic_id where doctor_id = ?", [req.user.user_id]);
      res.render("doctor/schedule.ejs", { errors: errors.errors, clinics: result, data: req.body });
    }

  } else {
    res.redirect("/login");
  }
});

app.get("/doctor/calendar", async function(req,res){
  if(req.isAuthenticated() && req.user.role_id == 2){
    try{
    const cal_events = [];
    const [cal_results] = await connection.query("Select start_time, end_time, DATE_FORMAT(date,'%Y-%m-%d') as date from doctor_calendar where doctor_id = ?", [req.user.user_id]);
    for(var i =0; i<cal_results.length; i++){
      const start_time = cal_results[i]["start_time"].substring(0,5);
      const end_time = cal_results[i]["end_time"].substring(0,5);
      cal_events.push({
        title: "Work from "+ tConvert(start_time) + " to "+ tConvert(end_time),
        start: cal_results[i]["date"]
      })
    }

    const [slots_results] = await connection.query("Select DATE_FORMAT(slot_date,'%Y-%m-%d') as slot_date, start_time, end_time from appointment_slots where doctor_id = ? ", [req.user.user_id]);
    console.log(slots_results);
    for(var i =0; i<slots_results.length; i++){
      const start_time = slots_results[i]["start_time"];
      const end_time = slots_results[i]["end_time"];
      cal_events.push({
        title: "Appointment",
        start: slots_results[i]["slot_date"] + "T"+ start_time,
        end: slots_results[i]["slot_date"] + "T"+ end_time
      })
    }
    console.log(cal_events);
    res.render("doctor/calendar.ejs", {events: cal_events});
  }catch(e){
    console.log(e);
  }


  }else{
    res.redirect("/login");
  }
});

//ChatBot

app.get("/chat", async function (req, res) {

  res.render("chat.ejs");
});


app.post("/chat2", async function (req, res) {
  if (req.isAuthenticated()) {
    var chat_memory = await load_chat_memory(req.user.user_id);
    var input = [
      { role: "system", content: "You are a helpful medical assistant for an app of many clinics and doctors ready to offer their services. Your role is to respond to the user's questions based on the available data. To get the needed data use the 'get_from_db' tool with an sql query. The current time is " + (new Date).toLocaleString() + "." },
      ...chat_memory,
      { role: "user", content: req.body.message }
    ];
    await save_chat_memory("user", { role: "user", content: req.body.message, user_id: req.user.user_id });
    console.log(input);
    const tools = [

      {
        "type": "function",
        "function": {
          "name": "get_from_db",
          "description": `Get data from a database.If no data is returned inform the user. The database has the following schema:
  
        ${schema}
        
        `,
          "parameters": {
            "type": "object",
            "properties": {
              "query": {
                "type": "string",
                "description": "SQL query to get data from a SQL database. Put single quotes around the fields but not table names. Select query only! And for more accurate searches use SQL 'LIKE' or any other efficient searching method. If using subqueries use the 'in' keyword not the '='"
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
      model: modelName,
      tools: tools,
      tool_choice: "auto",
      stream: true
    });

    let assistant_msg = "";
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
        assistant_msg += content;
      }
    }

    if (toolCallDetected) {
      console.log(finalToolCalls);

      await save_chat_memory("assistant_tool", { role: "assistant", tool_calls: JSON.stringify(finalToolCalls), user_id: req.user.user_id });

      input.push({
        role: "assistant",
        tool_calls: finalToolCalls
      });
      if (finalToolCalls) {
        for (const tool of finalToolCalls) {
          const args = JSON.parse(tool.function.arguments);
          const result = await call_tools(tool.function.name, args);

          await save_chat_memory("tool", { role: "tool", tool_call_id: tool.id, name: tool.function.name, content: result, user_id: req.user.user_id })

          input.push({
            role: "tool",
            tool_call_id: tool.id,
            name: tool.function.name,
            content: result
          });

        }

        const follow_up = await client.chat.completions.create({
          messages: input,
          temperature: 1.0,
          top_p: 1.0,
          model: modelName,
          tools: tools,
          tool_choice: "auto",
          stream: true
        });
        let assistant_msg = "";
        for await (const chunk of follow_up) {
          const content = chunk.choices[0]?.delta?.content || '';
          res.write(content);
          assistant_msg += content;
        }
        await save_chat_memory("assistant", { role: "assistant", content: assistant_msg, user_id: req.user.user_id });
        return res.end();
      }
    }
    await save_chat_memory("assistant", { role: "assistant", content: assistant_msg, user_id: req.user.user_id });
    res.end();
  } else {
    res.redirect("/login");
  }

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