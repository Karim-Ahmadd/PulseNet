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
import { validate_clinic_schedule_form, getNextDate, validate_doctor_schedule_form, tConvert, validate_clinic_updateSchedule_form, validate_doctor_updateSchedule_form } from "./lib/schedule_form";
import { call_tools } from "./lib/chat_tools";
import { toZonedTime } from 'date-fns-tz'
import { buildCalendar } from "./lib/calendar.js";
import { error } from "console";


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
    res.redirect("/patient");
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
      const errors = await validate_clinic_schedule_form(availableDays, startTime, endTime, weeksToGenerate, clinicId);
      if (!errors.iserror) {
        const today = toZonedTime(new Date(), "Asia/Beirut");
        const messages = [];
        for(var i =0; i<availableDays.length; i++) {
          let currentDate = getNextDate(availableDays[i], today);

          for (let week = 0; week < weeksToGenerate; week++) {
            const dateStr = currentDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Beirut" }); // format as 'YYYY-MM-DD' Beirut time
            var canGenerateDate = true;

            try{
                const [booked_appointments] = await connection.query("Select 1 from appointment_slots where is_booked = 1 and doctor_day_id in (Select doctor_day_id from doctor_calendar as d inner join clinic_calendar as c on c.schedule_id = d.clinic_day_id where c.date=? and c.clinic_id = ?)", [dateStr, clinicId]);
                if(booked_appointments.length != 0){
                    messages.push("During "+ dateStr+", some appointments are already scheduled")
                    canGenerateDate = false;
                }
            }catch(e){
                console.log(e);
            }

            if(canGenerateDate){
                // === Add/Update clinic_calendar row ===
                try {
                    await connection.query("INSERT INTO `pulse`.`clinic_calendar` (`clinic_id`,`day_of_week`,`is_open`,`opening_time`,`closing_time`,`date`)VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE opening_time = VALUES(opening_time), closing_time = VALUES(closing_time),is_open = 1", [clinicId, dayNumberToName[availableDays[i]], 1, startTime, endTime, dateStr]);
                } catch (e) {
                    console.log(e);
                }
            }

            currentDate.setDate(currentDate.getDate() + 7);
          }
        }
        res.render("admin/clinic_calendar.ejs", { clinic_id: clinicId, errors: messages });
      } else {
        res.render("admin/clinic_schedule_form.ejs", { clinic_id: clinicId, errors: errors.errors });
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
    const errors = await validate_clinic_updateSchedule_form(clinic_id, open_time, close_time, schedule_id);
    if(!errors.iserror){
      const [result] = await connection.query("Select 1 from clinic_calendar where schedule_id = ? and clinic_id =?", [schedule_id, clinic_id]);
      if (result.length === 0) {
        res.redirect("/admin/clinics/schedule");
      } else if (result.length === 1) {
        const messages = [];
        var canUpdateDate = true;
        try{
          const [booked_appointments] = await connection.query("Select 1 from appointment_slots as a inner join doctor_calendar as d on a.doctor_day_id = d.schedule_id where is_booked =1 and clinic_day_id = ?", [schedule_id]);
          if(booked_appointments.length != 0){
            messages.push("Some appointments are already booked at the selected date. Cannot update!");
            canUpdateDate = false;
          }
        }catch(e){
          console.log(e);
        }
        if(canUpdateDate){
          await connection.query("update clinic_calendar set opening_time = ?, closing_time = ? where schedule_id = ?", [open_time, close_time, schedule_id]);
        }
        res.render("admin/clinic_calendar.ejs", { clinic_id: clinic_id, errors: messages });
      }
    }else{
      res.render("admin/clinic_schedule_form.ejs", { start: open_time, end: close_time, schedule_id: schedule_id, clinic_id: clinic_id, errors: errors.errors });
    }

  } else {
    res.redirect("/login");
  }



});

app.post("/admin/clinics/deleteSchedule", async function (req, res) {

  if (req.isAuthenticated() && req.user.role_id == 1) {

    const { clinic_id, schedule_id } = req.body;
    const [result] = await connection.query("Select 1 from clinic_calendar where schedule_id = ? and clinic_id =?", [schedule_id, clinic_id]);
    if (result.length === 0) {
      res.redirect("/admin/clinics/schedule");
    } else if (result.length === 1) {
      const messages = [];
      var canDeleteDate = false;

      try{
          const [booked_appointments] = await connection.query("Select 1 from appointment_slots as a inner join doctor_calendar as d on a.doctor_day_id = d.schedule_id where is_booked =1 and clinic_day_id = ?", [schedule_id]);
          if(booked_appointments.length != 0){
            messages.push("Some appointments are already booked at the selected date. Cannot delete!");
            canDeleteDate = false;
          }
      }catch(e){
        console.log(e);
      }
      if(canDeleteDate){
        await connection.query("update clinic_calendar set is_open = 0 where schedule_id = ?", [schedule_id]);
      }
      res.render("admin/clinic_calendar.ejs", { clinic_id: clinic_id, errors: messages });
    }

  } else {
    res.redirect("/login");
  }



});

//Doctor
app.get("/doctor", async function (req, res) {
  if (req.isAuthenticated() && req.user.role_id == 2) {

    const [booked_appointments] = await connection.query("Select appointment_id, p.first_name, p.last_name, DATE_FORMAT(slot_date,'%Y-%m-%d') as date, TIME_FORMAT(start_time, '%h %i %p') as time, c.address, status from appointments as a inner join appointment_slots as s on a.slot_id = s.slot_id inner join patients as p on p.user_id = a.patient_id inner join clinics as c on c.clinic_id = s.clinic_id where status = 'Scheduled' and s.doctor_id = ? and s.is_booked = 1", [req.user.user_id]);

    const [completed_appointments] = await connection.query("Select count(*) as count from appointments as a inner join appointment_slots as s on a.slot_id = s.slot_id  where status = 'Completed' and s.doctor_id = ? and s.is_booked = 1", [req.user.user_id]);

    const [num_patients] = await connection.query("Select count(Distinct(patient_id)) as count from appointments as a inner join appointment_slots as s on a.slot_id = s.slot_id  where status != 'Cancelled' and s.doctor_id = ? and s.is_booked = 1", [req.user.user_id]);

    const [doctor_name] = await connection.query("Select CONCAT(first_name, ' ', last_name) as name from doctors where user_id =?", [req.user.user_id]);
    res.render("doctor/doctor.ejs", {booked: booked_appointments, completed: completed_appointments[0]["count"], patients_num : num_patients[0]["count"], doctor_name: doctor_name[0]["name"]});
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
    if (!errors.iserror) {

      const today = toZonedTime(new Date(), "Asia/Beirut");
      const messages = [];
      for(var i =0; i< availableDays.length; i++){
        let currentDate = getNextDate(availableDays[i], today);

        for (let week = 0; week < weeksToGenerate; week++) {
          const dateStr = currentDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Beirut" }); // format as 'YYYY-MM-DD' Beirut time
          console.log(dateStr);
          console.log(messages);
          var canGenerateDate = true;
          var clinic_start;
          var clinic_end;
          var clinic_date_id;
          try{
            const [clinic_results] = await connection.query("Select schedule_id, opening_time, closing_time from clinic_calendar where clinic_id = ? and date = ?", [clinicId, dateStr]);
            if(clinic_results.length != 0){
                clinic_start = clinic_results[0]["opening_time"].substring(0,5);
                clinic_end = clinic_results[0]["closing_time"].substring(0,5);
                clinic_date_id = clinic_results[0]["schedule_id"];
            }
            console.log(startTime);
            console.log(clinic_start);
            console.log(endTime);
            console.log(clinic_end);
            
            if(clinic_results.length == 0){
                messages.push("The chosen clinic is not open during "+ dateStr);
                canGenerateDate = false;
            }else if(startTime < clinic_start || startTime >= clinic_end || endTime <= clinic_start || endTime> clinic_end ){
                messages.push("In "+ dateStr+ ",the chosen clinic is not open between "+ tConvert(startTime) + " "+ tConvert(endTime));
                canGenerateDate = false;
            }

            const [booked_appointments] = await connection.query("Select 1 from appointment_slots as a inner join doctor_calendar as d on a.doctor_day_id = d.schedule_id where is_booked = 1 and d.date =? and d.doctor_id = ?", [dateStr, req.user.user_id]);
            if(booked_appointments.length != 0){
                messages.push("Some appointments are booked during "+ dateStr);
                canGenerateDate= false;
            }
          }catch(e){
            console.log(e);
          }
          if(canGenerateDate){
          // === Add/Update clinic_calendar row ===
            try {
              const [result, fields] = await connection.execute("INSERT INTO `pulse`.`doctor_calendar` (`doctor_id`,`clinic_id`,`day_of_week`,`start_time`,`end_time`,`is_available`,`date`, `clinic_day_id`)VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time),is_available = 1, clinic_id = VALUES(clinic_id)", [req.user.user_id, clinicId, dayNumberToName[availableDays[i]], startTime, endTime, 1, dateStr, clinic_date_id]);

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
        }
          // Move to next week's same day
          currentDate.setDate(currentDate.getDate() + 7);
        }
        
      }
      const cal_events = await buildCalendar(req.user.user_id);
      res.render("doctor/calendar.ejs", {events: cal_events, errors: messages});

    } else {
      const [result] = await connection.query("Select clinics.clinic_id, clinics.name from clinic_doctor inner join clinics on clinics.clinic_id = clinic_doctor.clinic_id where doctor_id = ?", [req.user.user_id]);
      res.render("doctor/schedule.ejs", { errors: errors.errors, clinics: result, data: req.body });
    }

  } else {
    res.redirect("/login");
  }
});

app.get("/doctor/updateSchedule",async function(req,res){
  if(req.isAuthenticated && req.user.role_id == 2){
    const [results] = await connection.query("Select start_time, end_time, clinic_id from doctor_calendar where schedule_id = ? and doctor_id = ?", [req.query.scheduleId, req.user.user_id]);
    if(results.length != 0){
      const [clinics] = await connection.query("Select clinics.clinic_id, clinics.name from clinic_doctor inner join clinics on clinics.clinic_id = clinic_doctor.clinic_id where doctor_id = ?", [req.user.user_id]);

      res.render("doctor/updateSchedule.ejs", {open_time: results[0]["start_time"].substring(0,5), close_time: results[0]["end_time"].substring(0,5), clinic_id: results[0]["clinic_id"], clinics: clinics, schedule_id: req.query.scheduleId});
    }else{
      res.redirect("/doctor/calendar");
    }

  }else{
    res.redirect("/login");
  }
});

app.post("/doctor/updateSchedule",async function(req,res){
  if(req.isAuthenticated && req.user.role_id == 2){
    const clinicId = req.body.clinic;
    const startTime = req.body.open_time;
    const endTime = req.body.close_time;
    const lunchStart = req.body.lunch_start;
    const lunchEnd = req.body.lunch_end;
    const appointmentDurationMinutes = req.body.appointments_duration;
    const schedule = req.body.schedule_id;

    const errors = await validate_doctor_updateSchedule_form(startTime, endTime, lunchStart, lunchEnd, appointmentDurationMinutes, clinicId, req.user.user_id, schedule);
    if(!errors.iserror){
      const messages = [];
      var canUpdate = true;
      var clinic_start;
      var clinic_end;
      var clinic_date;
      // const [clinic_results]= await connection.query("Select c.opening_time, c.closing_time, DATE_FORMAT(c.date,'%Y-%m-%d') as date from clinic_calendar as c inner join doctor_calendar as d on d.clinic_day_id = c.schedule_id where d.schedule_id = ?", [schedule]);
      const [clinic_results]= await connection.query("Select c.opening_time, c.closing_time, DATE_FORMAT(c.date,'%Y-%m-%d') as date from clinic_calendar as c where c.clinic_id = ? and c.date in (Select date from doctor_calendar where schedule_id = ?)", [clinicId, schedule]);
      if(clinic_results.length != 0){
        clinic_start = clinic_results[0]["opening_time"].substring(0,5);
        clinic_end = clinic_results[0]["closing_time"].substring(0,5);
        clinic_date = clinic_results[0]["date"];
      }

      if(clinic_results.length == 0){
        messages.push("Clinic not open in the selected date");
        canUpdate = false;
      }else if(startTime < clinic_start || startTime >= clinic_end || endTime <= clinic_start || endTime> clinic_end ){
        messages.push("Clinic is not open from "+ tConvert(startTime)+ " to "+ tConvert(endTime)+ " during "+ clinic_date);
        canUpdate = false;
      }
      const [booked_appointments] = await connection.query("Select 1 from appointment_slots as a inner join doctor_calendar as d on a.doctor_day_id = d.schedule_id where is_booked = 1 and d.schedule_id = ?", [schedule]);
      if(booked_appointments.length != 0){
          messages.push("Some appointments are booked during "+ dateStr);
          canUpdate= false;
      }
      if(canUpdate){
        await connection.query("update doctor_calendar set clinic_id = ?, start_time = ?, end_time = ? where schedule_id = ?", [clinicId, startTime, endTime, schedule]);
        await connection.query("Delete from appointment_slots where doctor_day_id = ?", [schedule]);
        const [doctor_date] = await connection.query("Select DATE_FORMAT(date, '%Y-%m-%d') as date from doctor_calendar where schedule_id = ?", [schedule]);

        const startParts = startTime.split(':').map(Number);
        const endParts = endTime.split(':').map(Number);
        let slotStart = new Date();
        slotStart.setHours(startParts[0], startParts[1], 0, 0);
        const slotEnd = new Date();
        slotEnd.setHours(endParts[0], endParts[1], 0, 0);
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
          await connection.query("INSERT INTO `pulse`.`appointment_slots` (`doctor_id`,`clinic_id`,`slot_date`,`start_time`,`end_time`,`doctor_day_id`)VALUES(?,?,?,?,?,?)", [req.user.user_id, clinicId,doctor_date[0]["date"], slotStartTime, slotEndTime, schedule]);
          }catch(e){
            console.log(e);
          }
          slotStart = nextSlot;
        }
      }
      const cal_events = await buildCalendar(req.user.user_id);
      res.render("doctor/calendar.ejs", {events: cal_events, errors: messages});

    }else{
      const [result] = await connection.query("Select clinics.clinic_id, clinics.name from clinic_doctor inner join clinics on clinics.clinic_id = clinic_doctor.clinic_id where doctor_id = ?", [req.user.user_id]);
      res.render("doctor/updateSchedule.ejs", {data: req.body, clinics: result, schedule_id: schedule, errors: errors.errors});
    }

  }else{
    res.redirect("/login");
  }
});

app.post("/doctor/deleteSchedule", async function(req,res){
  if(req.isAuthenticated() && req.user.role_id == 2){
    const [results] = await connection.query("Select 1 from doctor_calendar where schedule_id = ? and doctor_id = ?", [req.body.schedule_id, req.user.user_id]);
    if(results.length != 0){
      const messages = [];
      const [booked_appointments] = await connection.query("Select DATE_FORMAT(slot_date, '%Y-%m-%d') as date from appointment_slots where doctor_day_id = ? and is_booked = 1", [req.body.schedule_id]);
      if(booked_appointments.length != 0){
        messages.push("Booked appointments exists for selected date: "+ booked_appointments[0]["date"]);
      }else{
        await connection.query("Delete from doctor_calendar where schedule_id = ?", [req.body.schedule_id]);
      }

      const cal_events = await buildCalendar(req.user.user_id);
      res.render("doctor/calendar.ejs", {events: cal_events, errors: messages});
    }else{
      res.redirect("/doctor/calendar");
    }


  }else{
    res.redirect("/login");
  }
});

app.get("/doctor/calendar", async function(req,res){
  if(req.isAuthenticated() && req.user.role_id == 2){
    try{
    const cal_events = await buildCalendar(req.user.user_id);
    res.render("doctor/calendar.ejs", {events: cal_events});
  }catch(e){
    console.log(e);
  }


  }else{
    res.redirect("/login");
  }
});

//Patient

app.get("/patient", async function(req,res){
  if(req.isAuthenticated() && req.user.role_id == 3){
    const [booked_appointments] = await connection.query("Select appointment_id, d.first_name, d.last_name, sp.specialty_name, DATE_FORMAT(slot_date,'%Y-%m-%d') as date, TIME_FORMAT(start_time, '%h %i %p') as time, c.address, status from appointments as a inner join appointment_slots as s on a.slot_id = s.slot_id inner join doctors as d on d.user_id = s.doctor_id inner join clinics as c on c.clinic_id = s.clinic_id inner join specialties as sp on sp.specialty_id = d.specialty_id where status = 'Scheduled' and a.patient_id = ? and s.is_booked = 1", [req.user.user_id]);

    const [completed_appointments] = await connection.query("Select count(*) as count from appointments as a inner join appointment_slots as s on a.slot_id = s.slot_id  where status = 'Completed' and a.patient_id = ? and s.is_booked = 1", [req.user.user_id]);
    const [num_doctors] = await connection.query("Select count(Distinct(doctor_id)) as count from appointments as a inner join appointment_slots as s on a.slot_id = s.slot_id  where status != 'Cancelled' and a.patient_id = ? and s.is_booked = 1", [req.user.user_id]);
    const [patient_name] = await connection.query("Select CONCAT(first_name, ' ', last_name) as name from patients where user_id =?", [req.user.user_id]);
    

  res.render("patient/patient.ejs", {booked: booked_appointments, completed: completed_appointments[0]["count"], doctors_num : num_doctors[0]["count"], patient_name: patient_name[0]["name"]});
  }else{
    res.redirect("/login");
  }
});

app.get("/patient/appointments", async function(req,res){
  if(req.isAuthenticated() && req.user.role_id == 3){
    
    res.render("patient/appointments.ejs");
  }else{
    res.redirect("/login");
  }
});

app.get("/patient/listAppointments", async function(req,res){
  // if(req.isAuthenticated() && req.user.role_id == 3){
    const input = req.query?.input?.toLowerCase();

    const today = toZonedTime(new Date(), "Asia/Beirut");
    const time = today.toTimeString().split(" ")[0];
    const date = today.toLocaleDateString("sv-SE", { timeZone: "Asia/Beirut" });

    const [result] = await connection.query("Select sl.slot_id, d.first_name, d.last_name, sp.specialty_name, DATE_FORMAT(sl.slot_date,'%Y-%m-%d') as date, TIME_FORMAT(sl.start_time, '%h %i %p') as time, c.address from appointment_slots as sl inner join doctors as d on d.user_id = sl.doctor_id inner join clinics as c on c.clinic_id = sl.clinic_id inner join specialties as sp on d.specialty_id = sp.specialty_id where (LOWER(d.first_name) LIKE LOWER(CONCAT('%', ?, '%')) OR LOWER(d.last_name) LIKE LOWER(CONCAT('%', ?, '%')) OR LOWER(CONCAT(d.first_name, ' ', d.last_name)) LIKE LOWER(CONCAT('%', ?, '%')) OR LOWER(c.name) LIKE LOWER(CONCAT('%', ?, '%'))) AND is_booked = 0 AND sl.slot_date >= ? AND sl.start_time >= ?", [input, input, input, input, date, time]);

    console.log(result);

    res.json(result);
  // }else{
  //   console.log("HERE")
  //   res.redirect("/login");
  // }
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