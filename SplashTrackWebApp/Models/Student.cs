using System.ComponentModel.DataAnnotations;

namespace SplashTrackWebApp.Models
{
    public class Student
    {
        public int Id { get; set; }

        [Required]
        [StringLength(100)]
        [Display(Name = "First Name")]
        public required string FirstName { get; set; }

        [StringLength(100)]
        [Display(Name = "Middle Name")]
        public string? MiddleName { get; set; }

        [Required]
        [StringLength(100)]
        [Display(Name = "Last Name")]
        public required string LastName { get; set; }

        [Required]
        [Display(Name = "Date of Birth")]
        public required DateOnly DateOfBirth { get; set; }

        [StringLength(50)]
        [Display(Name = "Student Number")]
        public string? StudentNumber { get; set; }

        [EmailAddress]
        [StringLength(256)]
        public string? Email { get; set; }

        [Phone]
        [StringLength(20)]
        [Display(Name = "Phone Number")]
        public string? PhoneNumber { get; set; }

        [Display(Name = "Full Name")]
        public string FullName => string.IsNullOrWhiteSpace(MiddleName)
            ? $"{FirstName} {LastName}"
            : $"{FirstName} {MiddleName} {LastName}";
    }
}
