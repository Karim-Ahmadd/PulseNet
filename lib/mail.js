import nodemailer from 'nodemailer';
import connection from './DB_connection';
import { tConvert } from './schedule_form';
import env from "dotenv";

env.config();



const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "karmoa4@gmail.com",
    pass: process.env.GOOGLE_APP_PASSWORD,
  },
});

const mail = {
    sendDoctorAppointmentConfirmation : async function(patient_id, slot_id){
        const [patient_info] = await connection.query("Select CONCAT(first_name,' ', last_name) as name, email from patients as p inner join users as u on p.user_id = u.user_id where u.user_id =?",[patient_id]);
        const [slot_info] = await connection.query("Select first_name, last_name, email, slot_date, start_time, end_time from appointment_slots as s inner join doctors as d on s.doctor_id = d.user_id inner join users as u on u.user_id = s.doctor_id where slot_id = ?", [slot_id]);

        await transporter.sendMail({
            from: 'karmoa4@gmail.com',
            to: "karmoa4@gmail.com",
            subject: "Booked Appointment Notification",
            text: `Patient: ${patient_info[0]["name"]} has booked your appointment with Date and Time: ${slot_info[0]["slot_date"]} from ${tConvert(slot_info[0]["start_time"].substring(0,5))} to ${tConvert(slot_info[0]["end_time"].substring(0,5))}`,
        });

    },

}

export default mail;